/**
 * FilePreviewModal - File preview and edit modal for workspace files
 *
 * Auto-save model (Typora/Obsidian-style): all editable files persist in the background
 * with a 1s debounce. No manual Save/Cancel buttons.
 * - **Code files**: writable Monaco directly.
 * - **Workspace Markdown**: one CM source state supplies editable live rendering
 *   and temporary source mode; the document survives embedded/fullscreen changes.
 * - **Settings Markdown**: its existing preview/edit entry uses a CM source editor.
 *
 * Edit capability comes from two sources (either is sufficient):
 * 1. `workspacePath` prop — Rust workspace_files via `useWorkspaceFileService`
 * 2. Explicit `onSave` — when caller provides save logic directly
 *    (e.g. Settings panels editing `~/.myagents/agents/...`)
 */
import { isImeComposingEvent } from '@/utils/imeKeyboard';
import { AtSign, Check, Copy, Edit2, Expand, Eye, FolderOpen, Loader2, LocateFixed, MoreHorizontal, X } from 'lucide-react';
import Tip from './Tip';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useState, useRef, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useCloseLayer } from '@/hooks/useCloseLayer';
import { useTabActive, useTabApiOptional } from '@/context/TabContext';
import { FileIcon } from '@/components/file-icon';
import { useWorkspaceChangeSignal } from '@/hooks/useWorkspaceChangeSignal';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import type { RichDocKind } from '../../shared/fileTypes';
import type { FilePreviewFocusTarget } from '@/types/filePreview';
import { getEditorMonacoLanguage, hasPathologicallyLongLine, isMarkdownFile } from '@/utils/languageUtils';
import { remapWorkspacePath, type WorkspacePathMove } from '@/utils/workspacePathMoves';
import { shortenPathForDisplay } from '@/utils/pathDetection';
import { retainFocusOnMouseDown } from '@/utils/focusRetention';
import { copyMarkdownAsRichText, copyPlainText } from '@/utils/markdownClipboard';
import { filePathDirname } from '@/utils/workspaceFileLinks';

import Markdown from './Markdown';
import { useToast } from './Toast';
import OverlayBackdrop from '@/components/OverlayBackdrop';
import { MenuItem } from '@/components/ui/MenuItem';
import { Popover } from '@/components/ui/Popover';
import type { MarkdownEditorHandle } from './markdown-editor/MarkdownEditor';
import type { ConflictSnapshot } from './markdown-editor/ConflictComparison';

// Lazy load Monaco Editor: the ~3MB bundle is only loaded when user first opens a file
const MonacoEditor = lazy(() => import('./MonacoEditor'));
const MarkdownEditor = lazy(() => import('./markdown-editor/MarkdownEditor'));
const ConflictComparison = lazy(() => import('./markdown-editor/ConflictComparison'));

// Lazy load the rich-document viewer (pdf.js / docx-preview / SheetJS / pptx-renderer).
// Heavy parse/render libs stay out of the main bundle — loaded only when a user
// opens a pdf/docx/xlsx/xls/pptx. PRD 0.2.20.
const RichDocViewer = lazy(() => import('./richdoc/RichDocViewer'));

// No-op change handler for read-only Monaco (stable reference avoids re-renders)
const noop = () => {};

// Static loading spinner (module-level to avoid allocation per render)
const monacoLoading = (
    <div className="flex h-full items-center justify-center bg-[var(--paper-elevated)] text-[var(--ink-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" />
    </div>
);

// Auto-save debounce delay (ms)
const AUTO_SAVE_DELAY = 1000;


export interface FilePreviewHandle {
    close: () => void;
    prepareTransition: (nextPath?: string) => Promise<boolean>;
}

interface FilePreviewModalProps {
    ref?: Ref<FilePreviewHandle>;
    /** File name to display */
    name: string;
    /** File content */
    content: string;
    /** File size in bytes */
    size: number;
    /** Relative path from agent directory (for saving) */
    path: string;
    /** Absolute local path for read-only previews outside the active workspace. */
    localPath?: string | null;
    /** When set, render the read-only rich-document viewer (pdf / docx / sheet /
     *  pptx) instead of the text/markdown editor. The byte payload is fetched
     *  inside RichDocViewer via the workspace file service, so `content` is
     *  unused and the edit machinery (autosave / Monaco) is fully bypassed. */
    richDocKind?: RichDocKind;
    /** Whether content is loading */
    isLoading?: boolean;
    /** Error message to display */
    error?: string | null;
    /** Callback when modal is closed */
    onClose: () => void;
    /** Callback after file is saved successfully */
    onSaved?: () => void;
    /** External save handler — enables editing even without Tab context */
    onSave?: (content: string) => Promise<void>;
    /** External reveal-in-finder handler — enables "Open in Finder" without Tab context */
    onRevealFile?: () => Promise<void>;
    /** Workspace authority for workspace files. External documents resolve
     *  relative references from localPath through the local-file read API. */
    workspacePath?: string | null;
    /** Notify parent that the file was renamed. Parent MUST update the
     *  `name`/`path` it passes back so subsequent saves target the new
     *  location (e.g., split-view's `splitFile` state). */
    onRenamed?: (newPath: string, newName: string) => void;
    /** When `true`, new workspace Markdown focuses the unified editor immediately;
     *  Settings Markdown opens its CM source editor
     *  instead of the rendered preview. Used by 「新建笔记」 flow so a fresh
     *  empty `note-…md` is immediately editable without an extra click. */
    initialEditMode?: boolean;
    /** When true, render inline (no portal/backdrop) for use in split-view panel */
    embedded?: boolean;
    /** Callback to open the fullscreen modal from embedded mode.
     *  Receives the current editor content so fullscreen opens with up-to-date text. */
    onFullscreen?: (currentContent?: string) => void;
    /** Switch to browser preview (only for HTML files with an active browser panel) */
    onSwitchToBrowser?: () => void;
    /** Initial line to scroll to */
    initialLineNumber?: number;
    /** User navigation target from workspace search/file links. Re-applies when requestId changes. */
    focusTarget?: FilePreviewFocusTarget;
    /** Parent-driven coarse refresh signal (e.g. AI file-modifying tool completed).
     *  The modal revalidates only the currently open `path` and applies content
     *  in place, preserving the preview/editor surface. */
    externalRefreshSignal?: number;
    /** Fired when live reload applies fresh disk content. Parent snapshots
     *  (split panel / fullscreen / DirectoryPanel modal state) should mirror
     *  this so remounting the modal does not fall back to stale content. */
    onExternalContentUpdated?: (file: { path: string; name: string; content: string; size: number }) => void;
    /** When provided, renders a「引用文件」icon button in the toolbar that injects
     *  `@<path>` into the chat input and closes the modal. Omit on non-chat surfaces
     *  (settings panels, agent admin pages) — the button hides automatically. */
    onQuoteFile?: (path: string) => void;
    /** Reveal this workspace-relative file inside the app's workspace tree. */
    onRevealInTree?: (path: string) => void;
    /** When provided, the source editor (Monaco for code, CM for Markdown)
     *  shows a floating「引用」menu on selection that injects `@<path>#L<start>[-L<end>]`
     *  into the chat input. Markdown preview mode (rendered HTML) intentionally does
     *  NOT surface this — line-mapping back to source is unreliable. */
    onQuoteSelection?: (path: string, startLine: number, endLine: number, text: string) => void;
}

/** Auto-save status indicator — same treatment as the existing code-file editor.
 *  Silent on idle; surfaces saving/saved/error only when relevant. */
function AutoSaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
    const { t } = useTranslation('chat');
    if (status === 'idle') {
        return null;
    }
    if (status === 'saving') {
        return (
            <span className="flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('workspaceFiles.filePreview.saving')}
            </span>
        );
    }
    if (status === 'saved') {
        return (
            <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                <Check className="h-3 w-3" />
                {t('workspaceFiles.filePreview.saved')}
            </span>
        );
    }
    return (
        <span className="flex items-center gap-1 text-xs text-[var(--error)]">
            <X className="h-3 w-3" />
            {t('workspaceFiles.filePreview.saveFailed')}
        </span>
    );
}

export type LiveReloadDecision = 'apply' | 'pending' | 'skip';

export function decideLiveReload(args: {
    incomingContent: string;
    currentContent: string;
    savedContent: string;
    canEdit: boolean;
}): LiveReloadDecision {
    if (
        args.incomingContent === args.currentContent ||
        args.incomingContent === args.savedContent
    ) {
        return 'skip';
    }
    if (args.canEdit && args.currentContent !== args.savedContent) {
        return 'pending';
    }
    return 'apply';
}

export function formatFilePreviewUpdateTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function isWorkspaceSaveConflict(err: unknown): boolean {
    if (typeof err === 'string') return err.includes('File changed externally');
    if (err instanceof Error) return err.message.includes('File changed externally');
    return false;
}

function LiveUpdateIndicator({
    updatedAt,
    pending,
}: {
    updatedAt: Date | null;
    pending: boolean;
}) {
    const { t } = useTranslation('chat');
    if (!updatedAt) return null;
    const label = pending ? t('workspaceFiles.filePreview.externalUpdate') : t('workspaceFiles.filePreview.updated');
    return (
        <span
            className="flex-shrink-0 whitespace-nowrap text-xs font-normal text-[var(--ink-subtle)]/80"
            title={pending ? t('workspaceFiles.filePreview.externalUpdateTitle') : t('workspaceFiles.filePreview.updatedTitle')}
        >
            {label} {formatFilePreviewUpdateTime(updatedAt)}
        </span>
    );
}

/** Inline filename editor for the toolbar's filename slot. Stays unmounted
 *  in the static state so consumers can keep the surrounding flex/grid
 *  layout simple (one slot, two render modes). Width auto-fits the draft
 *  via a `size`-style trick on the input — using `field-sizing: content`
 *  via inline style would be cleaner but isn't supported on all WebViews;
 *  inline `style.width = ch` keeps the input snug across platforms. */
function FilenameSlot({
    name,
    canRename,
    isEditing,
    draft,
    onDraftChange,
    onCommit,
    onCancel,
    onStartEdit,
    busy,
    className,
}: {
    name: string;
    canRename: boolean;
    isEditing: boolean;
    draft: string;
    onDraftChange: (v: string) => void;
    onCommit: (next: string) => void;
    onCancel: () => void;
    onStartEdit: () => void;
    busy: boolean;
    className: string;
}) {
    const { t } = useTranslation('chat');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            // Select the stem (everything before the last dot) so the user can
            // retype the name without extension first — Mac Finder behavior.
            const dot = draft.lastIndexOf('.');
            inputRef.current.setSelectionRange(0, dot > 0 ? dot : draft.length);
        }
        // Only run on transition into editing state; subsequent typing should
        // not re-select. Empty deps array would lint, but exhaustive-deps wants
        // `draft` — that's fine, the first render in edit mode is when this
        // matters and `draft` only changes on user input afterward.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing]);
    if (!isEditing) {
        return (
            <span
                className={`truncate ${className} ${canRename ? 'cursor-text' : ''}`}
                onDoubleClick={canRename ? onStartEdit : undefined}
                title={canRename ? t('workspaceFiles.filePreview.doubleClickRename') : undefined}
            >
                {name}
            </span>
        );
    }
    return (
        <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={busy}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
                // Let IME commit its candidate before interpreting rename keys.
                if (isImeComposingEvent(e)) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommit(draft);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            }}
            onBlur={() => {
                // Blur commits — matches Mac Finder. Escape (which cancels)
                // dispatches before blur, so a cancelled edit reaches the
                // cancel branch first and resets state; the subsequent blur
                // sees `isEditing` already false and is a no-op via the
                // outer ternary.
                onCommit(draft);
            }}
            // Stop propagation so the editor input doesn't trigger overlay
            // close-on-click-outside or grid-layout focus shifts.
            onClick={(e) => e.stopPropagation()}
            className={`min-w-0 flex-1 rounded-sm border border-[var(--accent)] bg-[var(--paper)] px-1 py-0 outline-none ${className}`}
            style={{ width: `${Math.max(draft.length + 1, 6)}ch` }}
        />
    );
}

/** "预览 / 编辑" segmented control — header thumb-style toggle, mirrors task-center/ModeSegment.tsx
 *  visual treatment so markdown view-mode switching reads as one affordance. */
function MdViewSegment({
    value,
    onChange,
    compact = false,
}: {
    value: 'preview' | 'edit';
    onChange: (mode: 'preview' | 'edit') => void;
    compact?: boolean;
}) {
    const { t } = useTranslation('chat');
    const baseBtn = compact
        ? 'compact-action gap-1 px-2 text-sm font-medium transition-colors'
        : 'compact-action gap-1.5 px-3 text-sm font-medium transition-colors';
    const activeBtn = 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-xs';
    const inactiveBtn = 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]';
    const iconCls = 'h-3.5 w-3.5';
    return (
        <div className="inline-flex gap-0.5 rounded-[var(--radius-md)] bg-[var(--paper-inset)] p-0.5">
            <button
                type="button"
                onClick={() => onChange('preview')}
                onMouseDown={retainFocusOnMouseDown}
                aria-pressed={value === 'preview'}
                className={`${baseBtn} ${value === 'preview' ? activeBtn : inactiveBtn}`}
            >
                <Eye className={iconCls} strokeWidth={1.75} />
                {t('workspaceFiles.filePreview.previewMode')}
            </button>
            <button
                type="button"
                onClick={() => onChange('edit')}
                onMouseDown={retainFocusOnMouseDown}
                aria-pressed={value === 'edit'}
                className={`${baseBtn} ${value === 'edit' ? activeBtn : inactiveBtn}`}
            >
                <Edit2 className={iconCls} strokeWidth={1.75} />
                {t('workspaceFiles.filePreview.editMode')}
            </button>
        </div>
    );
}

export default function FilePreviewModal({
    ref,
    name,
    content,
    size,
    path,
    localPath = null,
    richDocKind,
    isLoading = false,
    error = null,
    onClose,
    onSaved,
    onSave,
    onRevealFile,
    workspacePath = null,
    onRenamed,
    initialEditMode = false,
    embedded = false,
    onFullscreen,
    onSwitchToBrowser,
    initialLineNumber,
    focusTarget,
    externalRefreshSignal,
    onExternalContentUpdated,
    onQuoteFile,
    onRevealInTree,
    onQuoteSelection,
}: FilePreviewModalProps) {
    const { t } = useTranslation('chat');
    const tabApi = useTabApiOptional();
    const tabActive = useTabActive();
    const isPreviewActive = !tabApi || tabActive;
    const [markdownFullscreen, setMarkdownFullscreen] = useState(false);
    const embeddedPlaceholderRef = useRef<HTMLDivElement>(null);
    const [markdownPortalTarget] = useState(() => document.createElement('div'));
    useLayoutEffect(() => {
        if (!embedded) return;
        const target = markdownFullscreen ? document.body : embeddedPlaceholderRef.current;
        if (!target) return;
        markdownPortalTarget.className = markdownFullscreen
            ? 'fixed inset-0 z-[210] flex items-center justify-center bg-black/30 p-[3vh_3vw]'
            : 'h-full min-h-0';
        target.appendChild(markdownPortalTarget);
        return () => markdownPortalTarget.remove();
    }, [embedded, markdownFullscreen, markdownPortalTarget]);
    useLayoutEffect(() => {
        // The fullscreen target lives outside the Tab's hidden DOM subtree.
        // Project the existing Tab authority without detaching its document.
        markdownPortalTarget.style.display = isPreviewActive ? '' : 'none';
        markdownPortalTarget.inert = !isPreviewActive;
    }, [isPreviewActive, markdownPortalTarget]);
    // Cmd+W dismissal: only register for fullscreen mode (z-[210]).
    // Embedded mode (split-panel) has no z-index overlay and is handled separately.
    // Routes through `handleCloseRef` (latest-ref pattern) so Cmd+W respects the same
    // `flushAndClose` autosave drain that the X button uses — without this, edits made
    // after the last debounce fire would be silently lost on Cmd+W.
    const handleCloseRef = useRef<() => void>(onClose);
    useCloseLayer(() => { if (!isPreviewActive || embedded && !markdownFullscreen) return false; handleCloseRef.current(); return true; }, 210);

    // Mounted guard for async autosave callbacks. Project convention requires this on any
    // setState that runs after `await`; without it, an in-flight save resolving after
    // unmount produces React "set state on unmounted component" warnings and may shadow
    // the next mount's state.
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    const toast = useToast();
    // Stabilize toast reference to avoid unnecessary effect re-runs
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const tRef = useRef(t);
    tRef.current = t;

    const fileService = useWorkspaceFileService(workspacePath);

    // Phase E (PRD 0.2.7): the legacy `apiPost('/agent/save-file')` fallback
    // is removed — workspace edits go through Rust workspace_files
    // exclusively. Edit is enabled when `workspacePath` is provided
    // (fileService.saveFile path) OR an explicit `onSave` prop overrides
    // (Settings panels editing `~/.myagents/agents/...`).
    // Rich documents are read-only — never engage the edit machinery (autosave,
    // Monaco, the 预览/编辑 segment) even when a workspacePath is present.
    const canEdit = !richDocKind && !!(workspacePath || onSave);
    // Reveal: explicit `onRevealFile` prop OR `workspacePath` (modal asks
    // fileService directly). Phase D.5 red-line: routes go through Rust
    // workspace_files, never sidecar HTTP. Either path is acceptable, so
    // Chat.tsx's split-view / fullscreen mounts don't need to wire
    // onRevealFile manually — passing `workspacePath` is enough.
    const canReveal = !!(onRevealFile || workspacePath || localPath);

    const isMarkdown = useMemo(() => isMarkdownFile(name), [name]);
    const isWorkspaceMarkdown = isMarkdown && canEdit && !!workspacePath && !onSave;
    const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
    const [markdownSourceMode, setMarkdownSourceMode] = useState(false);
    const conflictDiskRef = useRef<string | null>(null);
    const [conflictSnapshot, setConflictSnapshot] = useState<ConflictSnapshot | null>(null);
    const [conflictStale, setConflictStale] = useState(false);
    const [comparisonOpen, setComparisonOpen] = useState(false);
    const [receiptUnknown, setReceiptUnknown] = useState(false);
    // Keep the proposed result separate from the editable draft until the disk
    // receipt is definitive. A failed IPC reply may follow a successful write.
    const comparisonWriteRef = useRef<{ snapshot: ConflictSnapshot; result: string; diskOnly: boolean } | null>(null);
    const copyInFlightRef = useRef(false);
    const [copyBusy, setCopyBusy] = useState(false);
    const copiedMissingDraftRef = useRef<{ path: string; generation: number; revision: number } | null>(null);
    // Auto-save mode covers any editable file (markdown or code) — Typora/Obsidian-style.
    const isDirectEdit = canEdit;

    // ─── State ───────────────────────────────────────────────────────────────
    // Only onSave-owned Settings Markdown retains the preview/edit segment.
    // Workspace Markdown always opens the unified editable surface.
    const [mdViewMode, setMdViewMode] = useState<'preview' | 'edit'>(initialEditMode ? 'edit' : 'preview');
    const [editContent, setEditContent] = useState(content);
    const [savedContent, setSavedContent] = useState(content); // Last saved baseline (for diff/dirty)
    const [lastExternalUpdateAt, setLastExternalUpdateAt] = useState<Date | null>(null);
    const [externalUpdatePending, setExternalUpdatePending] = useState(false);
    const externalUpdatePendingRef = useRef(false);

    // Auto-save state (for any direct-edit file)
    const relocationRef = useRef<{ from: string; to: string } | null>(null);
    const documentGenerationRef = useRef(0);
    const pathGenerationRef = useRef(0);
    const synchronizedIdentityRef = useRef({ path, workspacePath });
    const [fileUnavailable, setFileUnavailable] = useState(false);
    const fileUnavailableRef = useRef(fileUnavailable);
    fileUnavailableRef.current = fileUnavailable;
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [markdownOversized, setMarkdownOversized] = useState(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSavingRef = useRef(false); // guard against concurrent saves
    const inFlightPromiseRef = useRef<Promise<void> | null>(null); // track in-flight save for close coordination
    const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const markdownScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingMarkdownScrollTopRef = useRef<number | null>(null);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const moreButtonRef = useRef<HTMLButtonElement | null>(null);

    // Sync content when prop changes (e.g., when file is reloaded externally OR when the
    // viewer switches to a different file in-place). MUST depend on `path`/`name` too:
    // without those, switching from `a.md` to `b.md` whose disk content happens to match
    // the cached `editContent` would let a still-pending debounce write `a.md` edits into
    // `b.md`'s path (pathRef updates synchronously below). Adding `path`/`name` to deps
    // forces the timer-clear + state-reset on file switch even when content is identical.
    useEffect(() => {
        // A committed rename preserves this document's draft and save baseline.
        // Only navigation to a different document resets the buffer.
        if (relocationRef.current?.to === path) return;
        const sameDocument = synchronizedIdentityRef.current.path === path && synchronizedIdentityRef.current.workspacePath === workspacePath;
        synchronizedIdentityRef.current = { path, workspacePath };
        const draft = markdownEditorRef.current?.getSource();
        if (sameDocument && draft !== undefined && draft !== savedContentRef.current) {
            if (content !== savedContentRef.current && content !== draft && isWorkspaceMarkdown) {
                externalUpdatePendingRef.current = true;
                conflictDiskRef.current = content;
                setExternalUpdatePending(true);
                setConflictStale(true);
            }
            return;
        }
        relocationRef.current = null;
        documentGenerationRef.current += 1;
        pathGenerationRef.current += 1;
        markdownEditorRef.current?.invalidateImports();
        markdownEditorRef.current?.replaceSource(content, true);
        setConflictSnapshot(null);
        setComparisonOpen(false); setReceiptUnknown(false); comparisonWriteRef.current = null;
        conflictDiskRef.current = null;
        setFileUnavailable(false);
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        setEditContent(content);
        editContentRef.current = content;
        setSavedContent(content);
        setMoreMenuOpen(false);
    }, [content, path, name, workspacePath, isWorkspaceMarkdown]);

    // Reset markdown view-mode + cancel any in-flight inline rename when the
    // file identity changes. Modal is reused for split-view file switches
    // (Chat.tsx mounts one instance and updates props); without these resets,
    //   - opening a new note via 「新建笔记」 with `initialEditMode=true` while
    //     the previous file was in 'preview' mode keeps the old mode (Codex
    //     round-4 CRIT-2);
    //   - a rename draft from file A could commit against file B if the user
    //     switches files mid-rename.
    useEffect(() => {
        if (relocationRef.current?.to === path) {
            relocationRef.current = null;
            return;
        }
        setMdViewMode(initialEditMode ? 'edit' : 'preview');
        setMarkdownSourceMode(false);
        setIsEditingName(false);
        externalUpdatePendingRef.current = false;
        setLastExternalUpdateAt(null);
        setExternalUpdatePending(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only path drives this; initialEditMode is read but does not retrigger
    }, [path]);

    useEffect(() => {
        if (focusTarget && isMarkdown && canEdit && !isWorkspaceMarkdown) {
            setMdViewMode('edit');
        }
    }, [canEdit, focusTarget, isMarkdown, isWorkspaceMarkdown]);

    // Syntax highlighting has its own budget, separate from the 2MB preview/save
    // cap. Normal source can highlight up to 1MB; unknown or long-line data stays
    // plaintext to preserve scroll/edit responsiveness.
    const effectiveMonacoLanguage = useMemo(() => {
        return getEditorMonacoLanguage(name, editContent, size);
    }, [editContent, name, size]);

    // Disable Monaco soft-wrap for files with a pathologically long line (data /
    // minified JSON): the advanced word-wrap layout of a 30k+ char line is the
    // dominant load cost and such lines are unreadable wrapped anyway.
    const monacoWordWrap = useMemo<'on' | 'off'>(
        () => (hasPathologicallyLongLine(editContent) ? 'off' : 'on'),
        [editContent],
    );

    // ─── Save logic (shared by auto-save and manual save) ────────────────────
    // Stable refs for save dependencies to avoid re-creating callbacks
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const fileServiceRef = useRef(fileService);
    fileServiceRef.current = fileService;
    const pathRef = useRef(path);
    if (!relocationRef.current || path !== relocationRef.current.from) {
        pathRef.current = path;
    }
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onExternalContentUpdatedRef = useRef(onExternalContentUpdated);
    onExternalContentUpdatedRef.current = onExternalContentUpdated;

    /** Core save function — saves the given content string. Phase E (PRD 0.2.7):
     *  workspace-relative paths go through `fileService.saveFile` (Rust
     *  `cmd_workspace_save_file`); explicit `onSave` prop still takes
     *  precedence for non-workspace surfaces (Settings panels editing
     *  `~/.myagents/...` files via direct fs writes). */
    const executeSave = useCallback(async (contentToSave: string, expectedContent?: string) => {
        if (onSaveRef.current) {
            await onSaveRef.current(contentToSave);
        } else if (fileServiceRef.current.isAvailable) {
            await fileServiceRef.current.saveFile({
                path: pathRef.current,
                content: contentToSave,
                expectedContent,
            });
        } else {
            throw new Error('File saving is unavailable');
        }
    }, []); // stable — all deps via refs

    // We need ref-accessible versions for async save callbacks
    const editContentRef = useRef(editContent);
    useLayoutEffect(() => { editContentRef.current = editContent; }, [editContent]);
    const readEditContent = useCallback(() => markdownEditorRef.current?.getSource() ?? editContentRef.current, []);
    const savedContentRef = useRef(savedContent);
    savedContentRef.current = savedContent;
    // Markdown is in "edit" mode when user toggled the segment AND the file is editable.
    // Read-only markdown stays in preview regardless of toggle (the toggle is hidden anyway).
    const isMdEditView = isMarkdown && canEdit && (isWorkspaceMarkdown || mdViewMode === 'edit');

    const liveReloadReqIdRef = useRef(0);
    const onRenamedRef = useRef(onRenamed);
    onRenamedRef.current = onRenamed;
    const applyPathMoves = useCallback((moves: WorkspacePathMove[]) => {
        const previous = pathRef.current;
        const next = remapWorkspacePath(previous, moves);
        if (next === previous) return;
        relocationRef.current = { from: relocationRef.current?.from ?? previous, to: next };
        // Crossing the Markdown/code boundary must transfer the current draft
        // before React unmounts the old editing surface.
        editContentRef.current = readEditContent();
        setEditContent(editContentRef.current);
        markdownEditorRef.current?.invalidateImports();
        synchronizedIdentityRef.current = { path: next, workspacePath: synchronizedIdentityRef.current.workspacePath };
        pathRef.current = next;
        liveReloadReqIdRef.current += 1;
        pathGenerationRef.current += 1;
        setConflictStale(true);
        setFileUnavailable(false);
        onRenamedRef.current?.(next, next.split('/').pop() ?? next);
    }, [readEditContent]);
    const workspaceChangeSignal = useWorkspaceChangeSignal(
        workspacePath,
        Boolean(workspacePath && path && !onSave),
        applyPathMoves,
    );

    useLayoutEffect(() => {
        const pendingTop = pendingMarkdownScrollTopRef.current;
        if (pendingTop == null) return;
        pendingMarkdownScrollTopRef.current = null;
        const el = markdownScrollRef.current;
        if (!el) return;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(pendingTop, maxTop);
    }, [editContent]);

    const comparisonIsCurrent = useCallback((comparison: Pick<ConflictSnapshot, 'path' | 'generation' | 'revision'>) =>
        comparison.path === pathRef.current && comparison.generation === pathGenerationRef.current &&
        comparison.revision === (markdownEditorRef.current?.getRevision() ?? 0), []);
    const acceptComparison = useCallback((result: string, diskOnly: boolean) => {
        // This is the only transition from a proposed comparison to live source.
        savedContentRef.current = result;
        setSavedContent(result);
        markdownEditorRef.current?.replaceSource(result, diskOnly);
        editContentRef.current = result;
        comparisonWriteRef.current = null;
        setReceiptUnknown(false); setFileUnavailable(false);
        externalUpdatePendingRef.current = false;
        setExternalUpdatePending(false); conflictDiskRef.current = null;
        setConflictSnapshot(null); setComparisonOpen(false); setConflictStale(false);
        setAutoSaveStatus('saved'); onSavedRef.current?.();
    }, []);

    const revalidateOpenFile = useCallback(async () => {
        if (!workspacePath || onSaveRef.current || richDocKind || !fileServiceRef.current.isAvailable) return false;
        const targetPath = pathRef.current;
        if (!targetPath) return false;
        const reqId = ++liveReloadReqIdRef.current;

        try {
            // Let this document's pending save settle before comparing its disk
            // snapshot; a rename notification can arrive before the save receipt.
            if (inFlightPromiseRef.current) await inFlightPromiseRef.current;
            if (!isMountedRef.current || reqId !== liveReloadReqIdRef.current || pathRef.current !== targetPath) return false;
            const payload = await fileServiceRef.current.readPreview({ path: targetPath });
            if (
                !isMountedRef.current ||
                reqId !== liveReloadReqIdRef.current ||
                pathRef.current !== targetPath
            ) {
                return false;
            }

            setFileUnavailable(false);
            const attempted = comparisonWriteRef.current;
            if (attempted) {
                if (payload.content === attempted.result && comparisonIsCurrent(attempted.snapshot)) {
                    acceptComparison(attempted.result, attempted.diskOnly); return true;
                }
                comparisonWriteRef.current = null; setReceiptUnknown(false);
                if (payload.content !== attempted.snapshot.disk || !comparisonIsCurrent(attempted.snapshot)) setConflictStale(true);
            }
            if (payload.content === readEditContent()) {
                savedContentRef.current = payload.content;
                setSavedContent(payload.content);
                externalUpdatePendingRef.current = false;
                setExternalUpdatePending(false);
                conflictDiskRef.current = null;
                setConflictSnapshot(null);
                return true;
            }
            const decision = decideLiveReload({
                incomingContent: payload.content,
                currentContent: readEditContent(),
                savedContent: savedContentRef.current,
                canEdit,
            });
            if (decision === 'skip') {
                if (externalUpdatePendingRef.current && payload.content === savedContentRef.current) {
                    externalUpdatePendingRef.current = false;
                    setExternalUpdatePending(false);
                    conflictDiskRef.current = null;
                    setConflictSnapshot(null);
                }
                return true;
            }

            const now = new Date();
            if (decision === 'pending') {
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = null;
                }
                externalUpdatePendingRef.current = true;
                if (conflictDiskRef.current !== payload.content) setConflictStale(true);
                conflictDiskRef.current = payload.content;
                setLastExternalUpdateAt(now);
                setExternalUpdatePending(true);
                return true;
            }

            const el = markdownScrollRef.current;
            if (isMarkdown && !isMdEditView && el) {
                pendingMarkdownScrollTopRef.current = el.scrollTop;
            }

            editContentRef.current = payload.content;
            markdownEditorRef.current?.replaceSource(payload.content, true);
            savedContentRef.current = payload.content;
            setEditContent(payload.content);
            setSavedContent(payload.content);
            setAutoSaveStatus('idle');
            externalUpdatePendingRef.current = false;
            setExternalUpdatePending(false);
            setLastExternalUpdateAt(now);
            onExternalContentUpdatedRef.current?.({
                path: targetPath,
                name: payload.name,
                content: payload.content,
                size: payload.size,
            });
            return true;
        } catch {
            if (isMountedRef.current && reqId === liveReloadReqIdRef.current && pathRef.current === targetPath) {
                setFileUnavailable(true);
            }
            return false;
        }
    }, [workspacePath, richDocKind, canEdit, isMarkdown, isMdEditView, readEditContent, comparisonIsCurrent, acceptComparison]);

    const revalidateOpenFileRef = useRef(revalidateOpenFile);
    revalidateOpenFileRef.current = revalidateOpenFile;

    useEffect(() => {
        if (workspaceChangeSignal > 0) {
            void revalidateOpenFileRef.current();
        }
    }, [workspaceChangeSignal]);

    const lastExternalRefreshSignalRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        const prev = lastExternalRefreshSignalRef.current;
        lastExternalRefreshSignalRef.current = externalRefreshSignal;
        if (
            externalRefreshSignal == null ||
            externalRefreshSignal <= 0 ||
            (prev !== undefined && externalRefreshSignal === prev)
        ) {
            return;
        }
        void revalidateOpenFileRef.current();
    }, [externalRefreshSignal]);

    // ─── Inline rename ────────────────────────────────────────────────────────
    // State + draft handling is set up here so the toolbar render path can
    // reference it before the auto-save callbacks are defined. The async
    // commit handler (which depends on `handleManualFlush`) lives further
    // down — `handleRenameCommit` is the forward-declared ref filled in
    // below; the toolbar reads it via `handleRenameCommitRef.current`.
    const canRename = !!workspacePath;
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(name);
    const [renameInFlight, setRenameInFlight] = useState(false);
    // Synchronous mirror of `renameInFlight` — `setState` lags one render,
    // so a synchronous double-fire (Enter then immediate blur) can both
    // observe `renameInFlight === false` and trigger duplicate commits.
    // The ref flips imperatively at the top of the commit body, blocking
    // the second call.
    const renameInFlightRef = useRef(false);
    useEffect(() => {
        if (!isEditingName) setNameDraft(name);
    }, [name, isEditingName]);
    const handleRenameCommitRef = useRef<(next: string) => void>(() => {});
    const handleRenameCommit = useCallback((next: string) => {
        handleRenameCommitRef.current(next);
    }, []);
    const handleRenameCancel = useCallback(() => {
        setIsEditingName(false);
        setNameDraft(name);
    }, [name]);
    const handleStartRename = useCallback(() => {
        if (!canRename) return;
        setNameDraft(name);
        setIsEditingName(true);
    }, [canRename, name]);

    // ─── Auto-save for direct-edit code files ─────────────────────────────────

    /** Persist the given content to disk, update status indicator, and call onSaved.
     *  Includes retry-after-busy: if a save is already in-flight, reschedules after it finishes. */
    const doAutoSave = useCallback((contentToSave: string) => {
        if (contentToSave === savedContentRef.current) return;
        if (fileUnavailableRef.current) { setAutoSaveStatus('error'); return; }
        const oversized = !!markdownEditorRef.current && !onSaveRef.current && new TextEncoder().encode(contentToSave).byteLength > 2 * 1024 * 1024;
        setMarkdownOversized(oversized);
        if (oversized) { setAutoSaveStatus('error'); return; }
        if (externalUpdatePendingRef.current) {
            // External disk content changed while this editor has local dirty
            // content. Do not let background auto-save silently overwrite it.
            return;
        }
        if (isSavingRef.current) {
            // Already saving — reschedule so this edit isn't lost
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                void doAutoSave(readEditContent());
            }, AUTO_SAVE_DELAY);
            return;
        }
        isSavingRef.current = true;
        setAutoSaveStatus('saving');
        const expectedContent = savedContentRef.current;
        const generation = documentGenerationRef.current;
        const savePromise = (async () => {
            try {
                await executeSave(contentToSave, expectedContent);
                if (!isMountedRef.current || generation !== documentGenerationRef.current) return;
                setFileUnavailable(false);
                // Always update the ref (drives `flushAndClose`'s dirty check)
                // unless an external-update conflict appeared while this save
                // was in flight. In that case the buffer remains logically
                // dirty until the user resolves/reopens; we must not clear the
                // conflict indicator just because an older debounce completed.
                const conflictPending = externalUpdatePendingRef.current;
                if (!conflictPending) {
                    savedContentRef.current = contentToSave;
                }
                if (isMountedRef.current) {
                    if (!conflictPending) {
                        setSavedContent(contentToSave);
                        externalUpdatePendingRef.current = false;
                        setExternalUpdatePending(false);
                        setLastExternalUpdateAt(null);
                        setAutoSaveStatus('saved');
                    } else {
                        setAutoSaveStatus('idle');
                    }
                    if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
                    savedIndicatorTimerRef.current = setTimeout(() => {
                        if (isMountedRef.current) setAutoSaveStatus('idle');
                    }, 2000);
                }
                onSavedRef.current?.();
                // After save completes, check if content changed during the save (user kept typing)
                if (isMountedRef.current && readEditContent() !== contentToSave) {
                    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = setTimeout(() => {
                        void doAutoSave(readEditContent());
                    }, AUTO_SAVE_DELAY);
                }
            } catch (err) {
                if (!isMountedRef.current || generation !== documentGenerationRef.current) return;
                if (isWorkspaceSaveConflict(err)) {
                    setAutoSaveStatus('idle');
                    void revalidateOpenFileRef.current();
                    return;
                }
                setAutoSaveStatus('error');
            } finally {
                isSavingRef.current = false;
                inFlightPromiseRef.current = null;
            }
        })();
        inFlightPromiseRef.current = savePromise;
        void savePromise;
    }, [executeSave, readEditContent]);

    const handleMarkdownChange = useCallback(() => {
        setConflictStale(true);
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => { void doAutoSave(readEditContent()); }, AUTO_SAVE_DELAY);
    }, [doAutoSave, readEditContent]);
    useEffect(() => {
        if (isMdEditView && !externalUpdatePending && readEditContent() !== savedContentRef.current) handleMarkdownChange();
    }, [externalUpdatePending, isMdEditView, handleMarkdownChange, readEditContent]);

    const handleDirectEditChange = useCallback((newValue: string) => {
        setEditContent(newValue);

        // Clear previous debounce
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            void doAutoSave(newValue);
        }, AUTO_SAVE_DELAY);
    }, [doAutoSave]);

    const flushForTransition = useCallback(async (): Promise<boolean> => {
        const generation = documentGenerationRef.current;
        markdownEditorRef.current?.setImportsEnabled(false);
        try {
        if (markdownEditorRef.current && !await markdownEditorRef.current.settleComposition()) return false;
        await markdownEditorRef.current?.settleImports();
        // Cancel pending debounce
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        // Wait for any in-flight save to finish before checking dirty state
        if (inFlightPromiseRef.current) {
            try { await inFlightPromiseRef.current; } catch { /* ignore — error already handled */ }
        }
        if (!isMountedRef.current || generation !== documentGenerationRef.current) return false;
        const copied = copiedMissingDraftRef.current;
        if (copied && copied.path === pathRef.current && copied.generation === pathGenerationRef.current && copied.revision === markdownEditorRef.current?.getRevision()) return true;
        if (
            externalUpdatePendingRef.current &&
            isDirectEdit &&
            readEditContent() !== savedContentRef.current
        ) {
            toastRef.current.warning(tRef.current('workspaceFiles.filePreview.toasts.externalUpdateConflict'));
            return false;
        }
        // If there are STILL unsaved direct-edit changes after in-flight completed, save now
        if (isDirectEdit && readEditContent() !== savedContentRef.current) {
            const toSave = readEditContent();
            doAutoSave(toSave);
            await inFlightPromiseRef.current;
            if (!isMountedRef.current || generation !== documentGenerationRef.current) return false;
            if (savedContentRef.current !== toSave) {
                // The component owns the only copy of this dirty buffer.
                // Keep it mounted when persistence failed.
                toastRef.current.error(tRef.current('workspaceFiles.filePreview.toasts.closeAutosaveFailed'));
                return false;
            }
        }
        return !isDirectEdit || readEditContent() === savedContentRef.current;
        } finally {
            if (isMountedRef.current && generation === documentGenerationRef.current) markdownEditorRef.current?.setImportsEnabled(true);
        }
    }, [isDirectEdit, doAutoSave, readEditContent]);

    const flushAndClose = useCallback(async () => {
        if (await flushForTransition()) onClose();
    }, [flushForTransition, onClose]);

    /** Cmd+S handler for direct-edit mode — flush debounce and save immediately */
    const handleManualFlush = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (
            externalUpdatePendingRef.current &&
            readEditContent() !== savedContentRef.current
        ) {
            toastRef.current.warning(tRef.current('workspaceFiles.filePreview.toasts.externalUpdateConflict'));
            return;
        }
        if (readEditContent() === savedContentRef.current) return; // nothing to save
        void doAutoSave(readEditContent());
    }, [doAutoSave, readEditContent]);

    // Wire the actual rename commit logic now that `handleManualFlush` is
    // defined. The toolbar reaches this through the ref-bouncer above so its
    // closure doesn't capture the early-binding `handleManualFlush` undefined.
    //
    // Rename uses fileService.rename → Rust `cmd_workspace_rename` (validates
    // Windows reserved names, path traversal, collision; rejects with error
    // string). Available only when `workspacePath` is set — Settings panels
    // editing `~/.myagents/agents/...` (which use the `onSave` prop) keep
    // the filename as a static span.
    useEffect(() => {
        handleRenameCommitRef.current = async (next: string) => {
            // Synchronous in-flight guard: Enter on the input followed
            // immediately by blur (focus shift, click outside) can both
            // fire `onCommit` before React has re-rendered with
            // `renameInFlight=true`. The ref flip is imperative and
            // observable on the same tick, blocking the second call.
            if (renameInFlightRef.current) return;

            const trimmed = next.trim();
            if (!trimmed || trimmed === name) {
                setIsEditingName(false);
                setNameDraft(name);
                return;
            }
            if (!canRename || !workspacePath) {
                setIsEditingName(false);
                return;
            }
            // Flush any pending autosave first — otherwise the in-flight save
            // would write to the OLD path, then rename would move it, leaving
            // the user's last keystrokes on the wrong file. `handleManualFlush`
            // kicks the save (no return value); `inFlightPromiseRef` lets us
            // await its completion before triggering rename.
            renameInFlightRef.current = true;
            setRenameInFlight(true);
            try {
                if (!await flushForTransition()) return;
                markdownEditorRef.current?.setImportsEnabled(false);
                const oldPath = pathRef.current;
                const { newPath } = await fileServiceRef.current.rename({
                    oldPath,
                    newName: trimmed,
                });
                if (!isMountedRef.current) return;
                // The event may arrive before or after this command receipt.
                // Applying its exact old→new mapping is idempotent.
                applyPathMoves([{ oldPath, newPath }]);
                setIsEditingName(false);
                setNameDraft(trimmed);
            } catch (err) {
                // Surface the Rust error string verbatim — it already reads
                // "Target name already exists" / "Name contains invalid
                // characters" / etc. Keep the editor open so the user can
                // correct without losing the draft.
                if (isMountedRef.current) {
                    toastRef.current.error(err instanceof Error ? err.message : tRef.current('workspaceFiles.filePreview.toasts.renameFailed'));
                }
            } finally {
                markdownEditorRef.current?.setImportsEnabled(true);
                renameInFlightRef.current = false;
                if (isMountedRef.current) setRenameInFlight(false);
            }
        };
    }, [name, canRename, workspacePath, applyPathMoves, flushForTransition]);

    // Cleanup on unmount: clear timers and fire best-effort save if dirty
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
            // Best-effort flush: if there are unsaved edits, fire a save (async, not awaited)
            if (!isWorkspaceMarkdown && !externalUpdatePendingRef.current && readEditContent() !== savedContentRef.current) {
                void executeSave(readEditContent(), savedContentRef.current).catch(() => {});
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs + stable executeSave; cleanup must only run on unmount
    }, []);

    // ─── Close handler ────────────────────────────────────────────────────────
    const handleClose = useCallback(() => {
        if (markdownFullscreen) { void markdownEditorRef.current?.settleComposition().then(ready => { if (ready) setMarkdownFullscreen(false); }); return; }
        if (isDirectEdit) {
            // Auto-save mode: flush pending save and close (no unsaved-confirm — saves are realtime).
            void flushAndClose();
        } else {
            onClose();
        }
    }, [isDirectEdit, flushAndClose, onClose, markdownFullscreen]);

    // Keep the ref pointed at the latest handleClose so the Cmd+W layer (registered above
    // at module-top, before handleClose existed) routes through the autosave-aware path.
    handleCloseRef.current = handleClose;
    useImperativeHandle(ref, () => ({ close: handleClose, prepareTransition: nextPath => nextPath === pathRef.current ? Promise.resolve(true) : flushForTransition() }), [handleClose, flushForTransition]);


    // ─── Quote handlers ──────────────────────────────────────────────────────
    // Stable refs for quote callbacks: the Monaco selection listener registers once and
    // reads via ref so callback identity changes upstream don't tear down the listener.
    const onQuoteFileRef = useRef(onQuoteFile);
    onQuoteFileRef.current = onQuoteFile;
    const onQuoteSelectionRef = useRef(onQuoteSelection);
    onQuoteSelectionRef.current = onQuoteSelection;

    /** Toolbar「引用文件」: kick off any pending edit to disk, **await** the in-flight save
     *  before appending `@<path>` to chat input + closing — without the await the user could
     *  immediately hit ⏎ on the chat input while the file is still being written, causing the
     *  model to read pre-edit content. Mounted-guard after await: handleClose may have run
     *  via a different path (Cmd+W) during the save. */
    const handleQuoteFileClick = useCallback(async () => {
        if (!onQuoteFileRef.current || !await flushForTransition()) return;
        onQuoteFileRef.current(pathRef.current);
        onClose();
    }, [flushForTransition, onClose]);

    const absolutePathForDisplay = useMemo(() => {
        if (localPath) return localPath;
        if (!workspacePath) return path;
        const sep = workspacePath.includes('\\') ? '\\' : '/';
        return path ? `${workspacePath}${sep}${path}` : workspacePath;
    }, [localPath, path, workspacePath]);

    const handleCopyFilePath = useCallback(() => {
        copyPlainText(absolutePathForDisplay)
            .then(() => toastRef.current.success(tRef.current('workspaceFiles.filePreview.toasts.copiedFilePath')))
            .catch(() => toastRef.current.error(tRef.current('workspaceFiles.common.copyFailed')));
    }, [absolutePathForDisplay]);

    const handleCopyFullText = useCallback(() => {
        void (async () => {
            if (richDocKind) return;
            if (isLoading) {
                toastRef.current.warning(tRef.current('workspaceFiles.filePreview.toasts.copyWhileLoading'));
                return;
            }
            if (error) {
                toastRef.current.warning(tRef.current('workspaceFiles.filePreview.toasts.copyAfterPreviewFailed'));
                return;
            }

            const text = readEditContent();
            if (text.length === 0) {
                toastRef.current.warning(tRef.current('workspaceFiles.filePreview.emptyDocument'));
                return;
            }

            try {
                if (isMarkdown && (isWorkspaceMarkdown ? !markdownSourceMode : !isMdEditView)) {
                    const result = await copyMarkdownAsRichText(text);
                    toastRef.current.success(result === 'rich'
                        ? tRef.current('workspaceFiles.filePreview.toasts.copiedFullText')
                        : tRef.current('workspaceFiles.filePreview.toasts.copiedPlainText'));
                } else {
                    await copyPlainText(text);
                    toastRef.current.success(tRef.current('workspaceFiles.filePreview.toasts.copiedFullText'));
                }
            } catch {
                toastRef.current.error(tRef.current('workspaceFiles.common.copyFailed'));
            }
        })();
    }, [error, isLoading, isMarkdown, isMdEditView, richDocKind, readEditContent, isWorkspaceMarkdown, markdownSourceMode]);

    const handleRevealInTree = useCallback(() => {
        if (!onRevealInTree || localPath) return;
        onRevealInTree(pathRef.current);
        if (!embedded) handleCloseRef.current();
    }, [embedded, localPath, onRevealInTree]);

    /** Monaco-side selection quote: forwards line range + text to caller. The toolbar
     *  「引用文件」 path also closes the modal, but selection-quote intentionally does
     *  NOT — users typically quote multiple ranges in succession when reading code. */
    const handleMonacoQuote = useCallback((sel: { text: string; startLine: number; endLine: number }) => {
        onQuoteSelectionRef.current?.(pathRef.current, sel.startLine, sel.endLine, sel.text);
    }, []);

    // Only pass the Monaco quote callback when the parent opted in — keeps the floating
    // menu off non-chat surfaces (settings, etc.) for free.
    const monacoQuote = onQuoteSelection ? handleMonacoQuote : undefined;

    const handleSwitchToBrowserClick = useCallback(async () => {
        if (onSwitchToBrowser && await flushForTransition()) onSwitchToBrowser();
    }, [flushForTransition, onSwitchToBrowser]);

    const onFullscreenRef = useRef(onFullscreen);
    onFullscreenRef.current = onFullscreen;
    const handleFullscreenClick = useCallback(async () => {
        if (isWorkspaceMarkdown) { if (await markdownEditorRef.current?.settleComposition()) setMarkdownFullscreen(value => !value); return; }
        if (onFullscreenRef.current && await flushForTransition()) {
            // A move can update the parent's selected file while persistence is
            // pending. Use its current transition callback, not that old snapshot.
            onFullscreenRef.current?.(isDirectEdit ? readEditContent() : undefined);
        }
    }, [flushForTransition, isDirectEdit, isWorkspaceMarkdown, readEditContent]);

    const handleOpenInFinder = useCallback(async () => {
        if (!canReveal) return;
        try {
            if (onRevealFile) {
                await onRevealFile();
            } else if (workspacePath) {
                // No explicit override → modal handles it via the workspace
                // file service. `pathRef.current` reflects the latest path
                // (rename keeps it fresh).
                await fileServiceRef.current.openInFinder({ path: pathRef.current });
            } else if (localPath) {
                await fileServiceRef.current.openPathExternal({ fullPath: localPath, workspace: null });
            }
        } catch {
            toastRef.current.error(tRef.current('workspaceFiles.common.openFolderFailed'));
        }
    }, [canReveal, localPath, onRevealFile, workspacePath]);

    const renderMoreMenu = (compact: boolean) => {
        const iconClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
        const buttonClass = 'compact-action text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]';
        const runMenuAction = (action: () => void | Promise<void>) => {
            setMoreMenuOpen(false);
            void action();
        };

        return (
            <>
                <Tip label={t('workspaceFiles.common.more')} position="bottom" disabled={moreMenuOpen}>
                    <button
                        ref={moreButtonRef}
                        type="button"
                        onClick={() => setMoreMenuOpen(open => !open)}
                        onMouseDown={retainFocusOnMouseDown}
                        className={buttonClass}
                        aria-label={t('workspaceFiles.common.more')}
                    >
                        <MoreHorizontal className={iconClass} />
                    </button>
                </Tip>
                <Popover
                    open={moreMenuOpen && isPreviewActive}
                    onClose={() => setMoreMenuOpen(false)}
                    anchorRef={moreButtonRef}
                    placement="bottom-end"
                    className="w-48 py-1"
                >
                    {isWorkspaceMarkdown && <MenuItem icon={<Edit2 className="h-3.5 w-3.5" />} label={t('app:markdownEditor.source')} disabled={isLoading || !!error}
                        onClick={() => runMenuAction(() => setMarkdownSourceMode(true))} />}
                    {onQuoteFile && (
                        <MenuItem
                            icon={<AtSign className="h-3.5 w-3.5" />}
                            label={t('workspaceFiles.common.quote')}
                            onClick={() => runMenuAction(handleQuoteFileClick)}
                        />
                    )}
                    {onRevealInTree && !localPath && (
                        <MenuItem
                            icon={<LocateFixed className="h-3.5 w-3.5" />}
                            label={t('workspaceFiles.common.revealInTree')}
                            onClick={() => runMenuAction(handleRevealInTree)}
                        />
                    )}
                    <MenuItem
                        icon={<Copy className="h-3.5 w-3.5" />}
                        label={t('workspaceFiles.common.copyFilePath')}
                        onClick={() => runMenuAction(handleCopyFilePath)}
                    />
                    {canReveal && (
                        <MenuItem
                            icon={<FolderOpen className="h-3.5 w-3.5" />}
                            label={t('workspaceFiles.common.openContainingFolder')}
                            onClick={() => runMenuAction(handleOpenInFinder)}
                        />
                    )}
                    {canRename && (
                        <MenuItem
                            icon={<Edit2 className="h-3.5 w-3.5" />}
                            label={t('workspaceFiles.common.rename')}
                            onClick={() => runMenuAction(handleStartRename)}
                        />
                    )}
                    {!richDocKind && (
                        <MenuItem
                            icon={<Copy className="h-3.5 w-3.5" />}
                            label={t('workspaceFiles.filePreview.copyFullText')}
                            disabled={isLoading || !!error}
                            title={isLoading
                                ? t('workspaceFiles.filePreview.copyFullTextAfterLoad')
                                : error
                                  ? t('workspaceFiles.filePreview.copyFullTextPreviewFailed')
                                  : undefined}
                            onClick={() => runMenuAction(handleCopyFullText)}
                        />
                    )}
                </Popover>
            </>
        );
    };

    // ─── Render content ───────────────────────────────────────────────────────
    const renderPreviewContent = () => {
        if (isLoading) {
            return monacoLoading;
        }

        if (error) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--error)]">
                    <X className="h-8 w-8" />
                    <span className="text-sm">{error}</span>
                </div>
            );
        }

        // Rich documents (pdf / docx / xlsx / xls / pptx): dedicated read-only
        // viewer. Fetches its own bytes via the workspace file service; the
        // text/markdown/Monaco paths below are bypassed entirely.
        if (richDocKind) {
            return (
                <Suspense fallback={monacoLoading}>
                    {/* key={path}: a split-view file switch reuses this modal — keying
                        forces RichDocViewer to remount (clean state + viewer cleanup). */}
                    <RichDocViewer key={localPath ?? path} kind={richDocKind} path={path} workspacePath={workspacePath} localPath={localPath} />
                </Suspense>
            );
        }

        // One source state owns live rendering and the source-mode exit.
        if (isMdEditView) {
            return (
                <Suspense fallback={monacoLoading}>
                    <div className="h-full bg-[var(--paper-elevated)]">
                        <MarkdownEditor
                            ref={markdownEditorRef}
                            initialSource={readEditContent()}
                            sourceMode={!isWorkspaceMarkdown || markdownSourceMode}
                            onExitSource={isWorkspaceMarkdown ? () => setMarkdownSourceMode(false) : undefined}
                            path={path}
                            workspacePath={workspacePath}
                            allowImages={isWorkspaceMarkdown && !fileUnavailable}
                            active={isPreviewActive}
                            paused={!!conflictSnapshot && comparisonOpen || receiptUnknown}
                            autofocus={initialEditMode}
                            onChange={handleMarkdownChange}
                            onDetach={(source, sourcePath) => { if (sourcePath === pathRef.current) editContentRef.current = source; }}
                            onSave={handleManualFlush}
                            initialLineNumber={initialLineNumber}
                            focusTarget={focusTarget}
                            onQuote={monacoQuote}
                        />
                    </div>
                </Suspense>
            );
        }

        // Markdown: rendered preview (toggle = 预览, OR read-only file)
        if (isMarkdown) {
            // Drive preview from in-memory editContent (latest typing) so flipping back from
            // edit mode reflects what the user just typed even if the autosave debounce
            // hasn't fired yet.
            const previewSource = editContent;
            if (!previewSource.trim()) {
                return (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--paper-elevated)] text-[var(--ink-muted)]">
                        <FileIcon name={name} size="display" />
                        <p className="text-sm">{t('workspaceFiles.filePreview.emptyDocument')}</p>
                        {canEdit && (
                            <button type="button" onClick={() => setMdViewMode('edit')}
                                className="text-sm text-[var(--accent)] hover:underline">
                                {t('workspaceFiles.filePreview.switchToEdit')}
                            </button>
                        )}
                    </div>
                );
            }
            return (
                <div ref={markdownScrollRef} className="h-full overflow-auto overscroll-contain p-6 bg-[var(--paper-elevated)]">
                    <div className="ai-message-content mx-auto max-w-3xl">
                        <Markdown raw preserveNewlines basePath={filePathDirname(localPath ?? path ?? '')} workspacePath={workspacePath}>{previewSource}</Markdown>
                    </div>
                </div>
            );
        }

        // Code files: direct writable Monaco with auto-save (or read-only if no edit capability)
        return (
            <Suspense fallback={monacoLoading}>
                <div className="h-full bg-[var(--paper-elevated)]">
                    <MonacoEditor
                        value={isDirectEdit ? editContent : savedContent}
                        onChange={isDirectEdit ? handleDirectEditChange : noop}
                        language={effectiveMonacoLanguage}
                        wordWrap={monacoWordWrap}
                        readOnly={!isDirectEdit}
                        onSave={isDirectEdit ? handleManualFlush : undefined}
                        initialLineNumber={initialLineNumber}
                        focusTarget={focusTarget}
                        onQuote={monacoQuote}
                    />
                </div>
            </Suspense>
        );
    };

    const showMdSegment = isMarkdown && canEdit && !isWorkspaceMarkdown;
    const changeSettingsMode = (mode: 'preview' | 'edit') => {
        setEditContent(readEditContent());
        setMdViewMode(mode);
    };

    const refreshComparison = async () => {
        const editor = markdownEditorRef.current;
        if (!editor || !await editor.settleComposition()) return;
        editor.setImportsEnabled(false);
        try {
            await editor.settleImports();
            if (!await revalidateOpenFile()) throw new Error('Cannot refresh conflict comparison');
            if (conflictDiskRef.current == null) return;
            setConflictSnapshot({ local: readEditContent(), disk: conflictDiskRef.current, revision: editor.getRevision(),
                path: pathRef.current, generation: pathGenerationRef.current });
            setConflictStale(false); setComparisonOpen(true);
        } finally { editor.setImportsEnabled(true); }
    };
    const copyMarkdownDraft = async () => {
        if (copyInFlightRef.current) return;
        copyInFlightRef.current = true; setCopyBusy(true);
        try {
            const editor = markdownEditorRef.current;
            if (!editor || !await editor.settleComposition()) return;
            await editor.settleImports();
            if (inFlightPromiseRef.current) await inFlightPromiseRef.current;
            const snapshot = { path: pathRef.current, generation: pathGenerationRef.current, revision: editor.getRevision(), local: readEditContent() };
            const current = () => isMountedRef.current && comparisonIsCurrent(snapshot);
            const copy = await fileService.saveMarkdownCopy({ documentPath: snapshot.path, content: snapshot.local });
            toast.success(t('app:markdownEditor.conflict.copied', { path: copy.path }));
            if (!current()) { if (isMountedRef.current) toast.info(t('app:markdownEditor.conflict.copyOlder')); return; }
            try {
                const disk = await fileService.readPreview({ path: snapshot.path });
                if (current()) acceptComparison(disk.content, true);
            } catch {
                // A read failure alone isn't proof of deletion (UTF-8, size or
                // access errors also fail preview). Verify existence first.
                const checked = await fileService.checkPaths({ paths: [snapshot.path] });
                if (current() && checked.results[snapshot.path]?.exists === false) {
                    copiedMissingDraftRef.current = snapshot;
                    setConflictSnapshot(null); setComparisonOpen(false);
                }
            }
        } finally { copyInFlightRef.current = false; if (isMountedRef.current) setCopyBusy(false); }
    };
    const applyComparison = async (result: string, comparison: ConflictSnapshot, diskOnly: boolean) => {
        if (!comparisonIsCurrent(comparison)) { setConflictStale(true); return false; }
        if (inFlightPromiseRef.current) await inFlightPromiseRef.current;
        // Reconcile even an unknown previous receipt before sending another write.
        const payload = await fileService.readPreview({ path: comparison.path });
        if (!comparisonIsCurrent(comparison)) { setConflictStale(true); return false; }
        const attempted = comparisonWriteRef.current;
        if (attempted && payload.content === attempted.result) { acceptComparison(attempted.result, attempted.diskOnly); return true; }
        comparisonWriteRef.current = null; setReceiptUnknown(false);
        if (payload.content !== comparison.disk) { setConflictStale(true); conflictDiskRef.current = payload.content; return false; }
        if (diskOnly) { acceptComparison(result, true); return true; }
        if (new TextEncoder().encode(result).byteLength > 2 * 1024 * 1024) throw new Error('Markdown exceeds save limit');
        if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
        const write = { snapshot: comparison, result, diskOnly };
        comparisonWriteRef.current = write;
        isSavingRef.current = true; setAutoSaveStatus('saving');
        let accepted = false;
        const pending = (async () => {
            try {
                await executeSave(result, comparison.disk);
                if (!isMountedRef.current || comparisonWriteRef.current !== write) return;
                if (comparisonIsCurrent(comparison)) { acceptComparison(result, false); accepted = true; }
                else { comparisonWriteRef.current = null; setConflictStale(true); }
            } catch (error) {
                if (!isMountedRef.current || comparisonWriteRef.current !== write) return;
                try {
                    const receipt = await fileService.readPreview({ path: comparison.path });
                    if (!isMountedRef.current || comparisonWriteRef.current !== write) return;
                    comparisonWriteRef.current = null;
                    if (receipt.content === result && comparisonIsCurrent(comparison)) { acceptComparison(result, false); accepted = true; return; }
                    if (receipt.content !== comparison.disk) { conflictDiskRef.current = receipt.content; setConflictStale(true); }
                } catch { if (isMountedRef.current && comparisonWriteRef.current === write) setReceiptUnknown(true); }
                setAutoSaveStatus('error'); throw error;
            } finally { isSavingRef.current = false; inFlightPromiseRef.current = null; }
        })();
        // Other lifecycle operations await this receipt but report their own UI
        // errors. The comparison keeps the original rejection for its retry UI.
        inFlightPromiseRef.current = pending.catch(() => {});
        await pending;
        return accepted;
    };
    const conflictControls = isWorkspaceMarkdown && <>
        {markdownOversized && <div role="alert" className="px-4 py-1 text-xs text-[var(--error)]">{t('app:markdownEditor.oversized')}</div>}
        {(fileUnavailable || autoSaveStatus === 'error') && <div className="px-4 py-1 text-xs"><button disabled={copyBusy} onClick={() => { void copyMarkdownDraft().catch(() => toast.error(t('app:markdownEditor.conflict.failed'))); }}>{t('app:markdownEditor.conflict.copy')}</button></div>}
        {externalUpdatePending && <div className="flex items-center justify-between gap-2 px-4 py-1 text-xs text-[var(--ink-muted)]"><span>{t('app:markdownEditor.conflict.paused')}</span><button onClick={() => {
            if (conflictSnapshot) { void (async () => {
                const editor = markdownEditorRef.current; if (!editor || !await editor.settleComposition()) return;
                editor.setImportsEnabled(false);
                try { await editor.settleImports(); setComparisonOpen(true); } finally { editor.setImportsEnabled(true); }
            })(); }
            else void refreshComparison().catch(() => toast.error(t('app:markdownEditor.conflict.failed')));
        }}>{t('app:markdownEditor.conflict.resolve')}</button></div>}
        {conflictSnapshot && <Suspense fallback={monacoLoading}><ConflictComparison snapshot={conflictSnapshot} stale={conflictStale}
            visible={comparisonOpen} receiptUnknown={receiptUnknown}
            onClose={() => setComparisonOpen(false)} onRefresh={refreshComparison}
            onCopy={copyMarkdownDraft} onApply={applyComparison} /></Suspense>}
    </>;

    // ─── Embedded mode ────────────────────────────────────────────────────────
    if (embedded) {
        // Center the mode toggle when space permits, reserving the action column
        // before truncating the filename so 32px targets never overlap the toggle.
        // Narrow previews put the mode toggle on its own row; an absent toggle
        // takes no space. This keeps the filename readable at the same target size.
        return <div ref={embeddedPlaceholderRef} className="h-full min-h-0">{createPortal(
            <div role={markdownFullscreen ? 'dialog' : 'region'} aria-modal={markdownFullscreen || undefined}
                className={`@container relative flex h-full w-full flex-col overflow-hidden bg-[var(--paper-elevated)] text-[var(--ink)] ${markdownFullscreen ? 'max-w-7xl rounded-xl border border-[var(--line)] shadow-2xl' : ''}`}>
                <div className="relative z-10 grid flex-shrink-0 grid-cols-[minmax(0,1fr)_auto] @[480px]:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] min-h-12 items-center gap-2 px-4 py-1.5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[var(--paper-elevated)] after:to-[var(--paper-elevated-a0)]">
                    {/* Left: file info */}
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
                            <FileIcon name={name} size="regular" />
                        </div>
                        <FilenameSlot
                            name={name}
                            canRename={canRename}
                            isEditing={isEditingName}
                            draft={nameDraft}
                            onDraftChange={setNameDraft}
                            onCommit={handleRenameCommit}
                            onCancel={handleRenameCancel}
                            onStartEdit={handleStartRename}
                            busy={renameInFlight}
                            className="text-sm font-medium text-[var(--ink)]"
                        />
                        {isDirectEdit && <AutoSaveIndicator status={autoSaveStatus} />}
                        {fileUnavailable && <span role="status" className="text-xs text-[var(--error)]">{t('workspaceFiles.filePreview.fileUnavailable')}</span>}
                        <LiveUpdateIndicator updatedAt={lastExternalUpdateAt} pending={externalUpdatePending} />
                    </div>

                    {/* Middle: markdown view-mode toggle (centered) */}
                    <div className="col-span-2 row-start-2 flex items-center justify-center empty:hidden @[480px]:col-span-1 @[480px]:col-start-2 @[480px]:row-start-1">
                        {showMdSegment && (
                            <MdViewSegment value={mdViewMode} onChange={changeSettingsMode} compact />
                        )}
                    </div>

                    {/* Right: actions */}
                    <div className="col-start-2 row-start-1 flex flex-shrink-0 items-center justify-end gap-1 @[480px]:col-start-3">
                        {renderMoreMenu(true)}

                        {/* Switch to browser preview — only for HTML files with an active browser */}
                        {onSwitchToBrowser && (
                            <Tip label={t('workspaceFiles.filePreview.browserPreview')} position="bottom">
                                <button type="button" onClick={handleSwitchToBrowserClick}
                                    aria-label={t('workspaceFiles.filePreview.browserPreview')}
                                    className="compact-action text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
                                    <Eye className="h-3.5 w-3.5" />
                                </button>
                            </Tip>
                        )}

                        {onFullscreen && (
                            <Tip label={t('workspaceFiles.filePreview.fullscreenPreview')} position="bottom">
                                <button type="button" onClick={handleFullscreenClick}
                                    aria-label={t('workspaceFiles.filePreview.fullscreenPreview')}
                                    className="compact-action text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
                                    <Expand className="h-3.5 w-3.5" />
                                </button>
                            </Tip>
                        )}

                        <Tip label={t('workspaceFiles.common.close')} position="bottom">
                            <button type="button" onClick={handleClose}
                                aria-label={t('workspaceFiles.common.close')}
                                className="compact-action text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </Tip>
                    </div>
                </div>
                {/* Content */}
                {conflictControls}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {renderPreviewContent()}
                </div>
            </div>, markdownPortalTarget
        )}</div>;
    }

    // ─── Fullscreen mode (portal) ─────────────────────────────────────────────
    return createPortal(
        <OverlayBackdrop onClose={handleClose} className="z-[210]" style={{ padding: '3vh 3vw', display: isPreviewActive ? undefined : 'none' }}>
            {/* Modal content */}
            <div
                className="@container glass-panel relative flex h-full w-full max-w-7xl flex-col overflow-hidden"
                onWheel={(e) => e.stopPropagation()}
            >
                {/* Header — 3-col grid keeps the markdown view-mode toggle visually centered */}
                <div className="grid flex-shrink-0 grid-cols-[minmax(0,1fr)_auto] @[480px]:grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-4 border-b border-[var(--line)] px-5 py-2 bg-[var(--paper-elevated)]">
                    {/* Left: file info */}
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                            <FileIcon name={name} size="display" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-3">
                                <FilenameSlot
                                    name={name}
                                    canRename={canRename}
                                    isEditing={isEditingName}
                                    draft={nameDraft}
                                    onDraftChange={setNameDraft}
                                    onCommit={handleRenameCommit}
                                    onCancel={handleRenameCancel}
                                    onStartEdit={handleStartRename}
                                    busy={renameInFlight}
                                    className="text-sm font-semibold text-[var(--ink)]"
                                />
                                {isDirectEdit && <AutoSaveIndicator status={autoSaveStatus} />}
                                {fileUnavailable && <span role="status" className="text-xs text-[var(--error)]">{t('workspaceFiles.filePreview.fileUnavailable')}</span>}
                                <LiveUpdateIndicator updatedAt={lastExternalUpdateAt} pending={externalUpdatePending} />
                            </div>
                            <div className="flex items-center gap-1.5">
                                {/* Show the absolute path (workspace + relative) shortened with `~`
                                    so users see "~/Documents/project/foo/bar.md" instead of just
                                    "bar.md". Title attribute carries the full unshortened path. */}
                                {(() => {
                                    const sep = workspacePath?.includes('\\') ? '\\' : '/';
                                    const absolute = localPath ?? (workspacePath ? `${workspacePath}${sep}${path}` : path);
                                    return (
                                        <span className="max-w-[400px] truncate text-xs text-[var(--ink-muted)]" title={absolute}>
                                            {shortenPathForDisplay(absolute)}
                                        </span>
                                    );
                                })()}
                                {canReveal && (
                                    <button
                                        type="button"
                                        onClick={handleOpenInFinder}
                                        className="compact-action text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                                        title={t('workspaceFiles.common.openContainingFolder')}
                                    >
                                        <FolderOpen className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Middle: markdown view-mode toggle (centered) */}
                    <div className="col-span-2 row-start-2 flex items-center justify-center empty:hidden @[480px]:col-span-1 @[480px]:col-start-2 @[480px]:row-start-1">
                        {showMdSegment && (
                            <MdViewSegment value={mdViewMode} onChange={changeSettingsMode} />
                        )}
                    </div>

                    {/* Right: actions */}
                    <div className="col-start-2 row-start-1 flex flex-shrink-0 items-center justify-end gap-1 @[480px]:col-start-3">
                        {renderMoreMenu(false)}
                        <button
                            type="button"
                            onClick={handleClose}
                            className="compact-action px-3 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                        >
                            {t('workspaceFiles.common.close')}
                        </button>
                    </div>
                </div>

                {/* Content area */}
                {conflictControls}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {renderPreviewContent()}
                </div>
            </div>
        </OverlayBackdrop>,
        document.body
    );
}

/**
 * SkillDialogs - Shared dialog components for Skills & Commands
 * Extracted from SkillsCommandsList and GlobalSkillsPanel to avoid duplication
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, FolderOpen, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauriEnvironment } from '@/utils/browserMock';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import OverlayBackdrop from '@/components/OverlayBackdrop';

interface CreateDialogProps {
    title: string;
    name: string;
    description: string;
    onNameChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
    loading: boolean;
}

export function CreateDialog({
    title,
    name,
    description,
    onNameChange,
    onDescriptionChange,
    onConfirm,
    onCancel,
    loading
}: CreateDialogProps) {
    const { t } = useTranslation('settings');
    useCloseLayer(() => { onCancel(); return true; }, 300);

    return (
        <OverlayBackdrop className="z-[300]">
            <div className="w-full max-w-md rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
                <h3 className="text-lg font-semibold text-[var(--ink)]">{title}</h3>
                <div className="mt-4 space-y-4">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('agentSettings.common.name')}</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder={t('agentSettings.skillDialogs.namePlaceholder')}
                            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.descriptionLabel')}</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => onDescriptionChange(e.target.value)}
                            placeholder={t('agentSettings.skillDialogs.descriptionPlaceholder')}
                            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)]"
                    >
                        {t('agentSettings.common.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={!name.trim() || loading}
                        className="flex items-center gap-2 rounded-lg bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                    >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t('agentSettings.common.create')}
                    </button>
                </div>
            </div>
        </OverlayBackdrop>
    );
}

interface NewSkillChooserProps {
    onWriteSkill: () => void;
    onUploadSkill: (file: File) => void;
    /** Import skill from a folder path (Tauri only) */
    onImportFolder?: (folderPath: string) => void;
    /** Install skill from a GitHub URL / npx skills command */
    onInstallFromUrl?: () => void;
    onCancel: () => void;
    /** Optional: sync from Claude Code functionality */
    syncConfig?: {
        onSync: () => Promise<void>;
        canSync: boolean;
        syncableCount: number;
    };
}

export function NewSkillChooser({
    onWriteSkill,
    onUploadSkill,
    onImportFolder,
    onInstallFromUrl,
    onCancel,
    syncConfig
}: NewSkillChooserProps) {
    const { t } = useTranslation('settings');
    useCloseLayer(() => { onCancel(); return true; }, 300);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [syncing, setSyncing] = useState(false);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onUploadSkill(file);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    };

    const handleFolderClick = async () => {
        if (!onImportFolder) return;

        try {
            // Use Tauri dialog to select folder
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: t('agentSettings.skillDialogs.folderPickerTitle'),
            });

            if (selected && typeof selected === 'string') {
                onImportFolder(selected);
            }
        } catch (err) {
            console.error('[SkillDialogs] Failed to open folder dialog:', err);
        }
    };

    const handleSyncClick = async () => {
        if (!syncConfig) return;
        setSyncing(true);
        try {
            await syncConfig.onSync();
        } finally {
            setSyncing(false);
        }
    };

    // Check if folder import is available (Tauri environment + handler provided)
    const canImportFolder = isTauriEnvironment() && !!onImportFolder;

    return (
        <OverlayBackdrop className="z-[300]">
            <div className="w-full max-w-md rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[var(--ink)]">{t('agentSettings.skillDialogs.newSkillTitle')}</h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg p-1.5 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)]"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="mt-6 space-y-3">
                    {/* Write Skill Option */}
                    <button
                        type="button"
                        onClick={onWriteSkill}
                        className="group flex w-full items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4 text-left transition-all hover:border-[var(--line-strong)] hover:shadow-sm"
                    >
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--paper-inset)] transition-colors group-hover:bg-[var(--accent-warm-subtle)]">
                            <svg className="h-6 w-6 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                        </div>
                        <div>
                            <div className="font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.writeSkillTitle')}</div>
                            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.writeSkillDescription')}</p>
                        </div>
                    </button>

                    {/* Upload Skill Option */}
                    <button
                        type="button"
                        onClick={handleUploadClick}
                        className="group flex w-full items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4 text-left transition-all hover:border-[var(--line-strong)] hover:shadow-sm"
                    >
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--paper-inset)] transition-colors group-hover:bg-[var(--accent-warm-subtle)]">
                            <svg className="h-6 w-6 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                        </div>
                        <div>
                            <div className="font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.uploadSkillTitle')}</div>
                            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.uploadSkillDescription')}</p>
                        </div>
                    </button>

                    {/* Install from URL Option */}
                    {onInstallFromUrl && (
                        <button
                            type="button"
                            onClick={onInstallFromUrl}
                            className="group flex w-full items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4 text-left transition-all hover:border-[var(--line-strong)] hover:shadow-sm"
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--paper-inset)] transition-colors group-hover:bg-[var(--accent-warm-subtle)]">
                                <Link2 className="h-6 w-6 text-[var(--ink-muted)]" />
                            </div>
                            <div>
                                <div className="font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.importFromUrlTitle')}</div>
                                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.importFromUrlDescription')}</p>
                            </div>
                        </button>
                    )}

                    {/* Import Folder Option - Only show in Tauri environment */}
                    {canImportFolder && (
                        <button
                            type="button"
                            onClick={handleFolderClick}
                            className="group flex w-full items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4 text-left transition-all hover:border-[var(--line-strong)] hover:shadow-sm"
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--paper-inset)] transition-colors group-hover:bg-[var(--accent-warm-subtle)]">
                                <FolderOpen className="h-6 w-6 text-[var(--ink-muted)]" />
                            </div>
                            <div>
                                <div className="font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.importFolderTitle')}</div>
                                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.importFolderDescription')}</p>
                            </div>
                        </button>
                    )}

                    {/* Sync from Claude Code Option - Only show when configured and has syncable skills */}
                    {syncConfig?.canSync && (
                        <button
                            type="button"
                            onClick={handleSyncClick}
                            disabled={syncing}
                            className="group flex w-full items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-4 text-left transition-all hover:border-[var(--line-strong)] hover:shadow-sm disabled:opacity-50"
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--paper-inset)] transition-colors group-hover:bg-[var(--accent-warm-subtle)]">
                                {syncing ? (
                                    <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-muted)]" />
                                ) : (
                                    <svg className="h-6 w-6 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                )}
                            </div>
                            <div>
                                <div className="font-medium text-[var(--ink)]">
                                    {t('agentSettings.skillDialogs.syncFromClaudeTitle')}
                                    <span className="ml-2 text-xs text-[var(--ink-muted)]">
                                        ({t('agentSettings.skillDialogs.syncableCount', { count: syncConfig.syncableCount })})
                                    </span>
                                </div>
                                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.syncFromClaudeDescription')}</p>
                            </div>
                        </button>
                    )}

                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip,.skill,.md"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                </div>
            </div>
        </OverlayBackdrop>
    );
}

// ---------------------------------------------------------------------------
// InstallFromUrlDialog — paste a GitHub URL / npx skills command and install
// ---------------------------------------------------------------------------

type InstallPreview =
    | {
          mode: 'marketplace';
          marketplaceName: string;
          marketplaceDescription?: string;
          plugins: Array<{
              name: string;
              description: string;
              skills: Array<{
                  suggestedFolderName: string;
                  name: string;
                  description: string;
                  hasDangerousTools: boolean;
                  conflict: boolean;
              }>;
          }>;
      }
    | {
          mode: 'multi';
          candidates: Array<{
              suggestedFolderName: string;
              name: string;
              description: string;
              hasDangerousTools: boolean;
              rootPath: string;
              conflict: boolean;
          }>;
      }
    | {
          mode: 'single-conflict';
          skill: {
              suggestedFolderName: string;
              name: string;
              description: string;
              hasDangerousTools: boolean;
              conflict: boolean;
          };
      };

export interface InstallFromUrlResponse {
    success: boolean;
    mode?: string;
    installed?: Array<{ folderName: string; name?: string; description?: string }>;
    preview?: InstallPreview;
    error?: string;
    sourceUrl?: string;
    effectiveRef?: string;
}

interface InstallFromUrlDialogProps {
    /** Called with the raw URL plus optional confirmed selection. Returns the server JSON. */
    onInstall: (
        url: string,
        confirmedSelection?: {
            pluginName?: string;
            folderNames?: string[];
            overwrite?: string[];
        },
    ) => Promise<InstallFromUrlResponse>;
    onCancel: () => void;
    onInstalled?: (folderNames: string[]) => void;
}

export function InstallFromUrlDialog({ onInstall, onCancel, onInstalled }: InstallFromUrlDialogProps) {
    const { t } = useTranslation('settings');
    useCloseLayer(() => { onCancel(); return true; }, 300);

    const [url, setUrl] = useState('');
    const [phase, setPhase] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<InstallPreview | null>(null);
    const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
    const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
    const [overwriteFolders, setOverwriteFolders] = useState<Set<string>>(new Set());

    // Guard setState after unmount — user can cancel mid-fetch and the pending
    // Promise will still resolve.
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // Phase rotation during a pending fetch (purely cosmetic — not driven by backend)
    useEffect(() => {
        if (!loading) return;
        const phases = [
            { at: 0, text: t('agentSettings.skillDialogs.phaseParsing') },
            { at: 600, text: t('agentSettings.skillDialogs.phaseDownloading') },
            { at: 3000, text: t('agentSettings.skillDialogs.phaseUnpacking') },
            { at: 8000, text: t('agentSettings.skillDialogs.phaseValidating') },
        ];
        const timers = phases.map(p => setTimeout(() => {
            if (isMountedRef.current) setPhase(p.text);
        }, p.at));
        return () => timers.forEach(clearTimeout);
    }, [loading, t]);

    const handleProbe = async () => {
        if (!url.trim() || loading) return;
        setError(null);
        setPreview(null);
        setSelectedPlugin(null);
        setSelectedFolders(new Set());
        setOverwriteFolders(new Set());
        setLoading(true);
        setPhase(t('agentSettings.skillDialogs.phaseParsing'));
        try {
            const result = await onInstall(url.trim());
            if (!isMountedRef.current) return;
            if (!result.success) {
                setError(result.error || t('agentSettings.skillDialogs.installFailed'));
                return;
            }
            if (result.mode === 'installed') {
                const folders = (result.installed ?? []).map(i => i.folderName);
                onInstalled?.(folders);
                return;
            }
            if (result.preview) {
                setPreview(result.preview);
                // For multi / marketplace first-plugin, auto-select non-conflicting items
                if (result.preview.mode === 'multi') {
                    setSelectedFolders(
                        new Set(
                            result.preview.candidates
                                .filter(c => !c.conflict)
                                .map(c => c.suggestedFolderName),
                        ),
                    );
                } else if (result.preview.mode === 'marketplace') {
                    const first = result.preview.plugins[0];
                    if (first) {
                        setSelectedPlugin(first.name);
                        setSelectedFolders(new Set(first.skills.map(s => s.suggestedFolderName)));
                    }
                }
            }
        } catch (err) {
            if (isMountedRef.current) setError(err instanceof Error ? err.message : t('agentSettings.skillDialogs.installFailed'));
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
                setPhase('');
            }
        }
    };

    const handleConfirm = async () => {
        if (!preview || loading) return;
        setError(null);
        setLoading(true);
        setPhase(t('agentSettings.skillDialogs.phaseInstalling'));
        try {
            let body: { pluginName?: string; folderNames?: string[]; overwrite?: string[] };
            if (preview.mode === 'marketplace') {
                if (!selectedPlugin) {
                    setError(t('agentSettings.skillDialogs.selectPluginRequired'));
                    return;
                }
                const plugin = preview.plugins.find(p => p.name === selectedPlugin);
                if (!plugin) return;
                const chosen = plugin.skills.filter(s => selectedFolders.has(s.suggestedFolderName));
                if (chosen.length === 0) {
                    setError(t('agentSettings.skillDialogs.selectSkillRequired'));
                    return;
                }
                body = {
                    pluginName: selectedPlugin,
                    folderNames: chosen.map(s => s.suggestedFolderName),
                    overwrite: chosen.filter(s => s.conflict && overwriteFolders.has(s.suggestedFolderName)).map(s => s.suggestedFolderName),
                };
            } else if (preview.mode === 'multi') {
                const chosen = preview.candidates.filter(c => selectedFolders.has(c.suggestedFolderName));
                if (chosen.length === 0) {
                    setError(t('agentSettings.skillDialogs.selectSkillRequired'));
                    return;
                }
                body = {
                    folderNames: chosen.map(c => c.suggestedFolderName),
                    overwrite: chosen.filter(c => c.conflict && overwriteFolders.has(c.suggestedFolderName)).map(c => c.suggestedFolderName),
                };
            } else {
                // single-conflict
                if (!overwriteFolders.has(preview.skill.suggestedFolderName)) {
                    setError(t('agentSettings.skillDialogs.overwriteRequired'));
                    return;
                }
                body = {
                    folderNames: [preview.skill.suggestedFolderName],
                    overwrite: [preview.skill.suggestedFolderName],
                };
            }

            const result = await onInstall(url.trim(), body);
            if (!isMountedRef.current) return;
            if (!result.success) {
                setError(result.error || t('agentSettings.skillDialogs.installFailed'));
                return;
            }
            if (result.mode === 'installed') {
                const folders = (result.installed ?? []).map(i => i.folderName);
                onInstalled?.(folders);
            }
        } catch (err) {
            if (isMountedRef.current) setError(err instanceof Error ? err.message : t('agentSettings.skillDialogs.installFailed'));
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
                setPhase('');
            }
        }
    };

    const toggleFolder = (name: string) => {
        setSelectedFolders(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };
    const toggleOverwrite = (name: string) => {
        setOverwriteFolders(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    return (
        <OverlayBackdrop className="z-[300]">
            <div className="w-full max-w-2xl rounded-2xl bg-[var(--paper-elevated)] p-6 shadow-2xl">
                <h3 className="text-lg font-semibold text-[var(--ink)]">{t('agentSettings.skillDialogs.installFromUrlTitle')}</h3>

                {!preview && (
                    <div className="mt-4">
                        <label className="mb-1.5 block text-sm font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.urlLabel')}</label>
                        <textarea
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            rows={5}
                            placeholder={t('agentSettings.skillDialogs.urlPlaceholder')}
                            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 font-mono text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                            disabled={loading}
                            autoFocus
                        />
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                            {t('agentSettings.skillDialogs.urlHint')}
                        </p>
                    </div>
                )}

                {loading && (
                    <div className="mt-4 flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink-muted)]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {phase || t('agentSettings.skillDialogs.processing')}
                    </div>
                )}

                {error && (
                    <div className="mt-4 rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] px-4 py-3 text-sm text-[var(--error)]">
                        {error}
                    </div>
                )}

                {preview && preview.mode === 'marketplace' && (
                    <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
                        <p className="text-sm text-[var(--ink-muted)]">
                            {t('agentSettings.skillDialogs.marketplaceFoundPrefix')}
                            <span className="font-medium text-[var(--ink)]">{preview.marketplaceName}</span>
                            {preview.marketplaceDescription && ` ${t('agentSettings.skillDialogs.marketplaceDescriptionSeparator')} ${preview.marketplaceDescription}`}
                        </p>
                        <p className="text-sm font-medium text-[var(--ink)]">{t('agentSettings.skillDialogs.selectPluginLabel')}</p>
                        {preview.plugins.map(plugin => (
                            <label
                                key={plugin.name}
                                className={`block cursor-pointer rounded-xl border p-3 transition-all ${
                                    selectedPlugin === plugin.name
                                        ? 'border-[var(--accent)] bg-[var(--accent-warm-subtle)]'
                                        : 'border-[var(--line)] bg-[var(--paper-elevated)] hover:border-[var(--line-strong)]'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    <input
                                        type="radio"
                                        name="plugin"
                                        value={plugin.name}
                                        checked={selectedPlugin === plugin.name}
                                        onChange={() => {
                                            setSelectedPlugin(plugin.name);
                                            setSelectedFolders(new Set(plugin.skills.map(s => s.suggestedFolderName)));
                                        }}
                                        className="mt-0.5"
                                    />
                                    <div className="flex-1">
                                        <div className="font-medium text-[var(--ink)]">
                                            {plugin.name}
                                            <span className="ml-2 text-xs text-[var(--ink-muted)]">({t('agentSettings.skillDialogs.skillCount', { count: plugin.skills.length })})</span>
                                        </div>
                                        {plugin.description && (
                                            <p className="mt-1 text-xs text-[var(--ink-muted)]">{plugin.description}</p>
                                        )}
                                        {selectedPlugin === plugin.name && (
                                            <div className="mt-2 space-y-1.5 border-t border-[var(--line)] pt-2">
                                                {plugin.skills.map(skill => (
                                                    <div key={skill.suggestedFolderName} className="flex items-center gap-2 text-xs">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedFolders.has(skill.suggestedFolderName)}
                                                            onChange={() => toggleFolder(skill.suggestedFolderName)}
                                                            onClick={e => e.stopPropagation()}
                                                        />
                                                        <span className="font-mono text-[var(--ink)]">{skill.suggestedFolderName}</span>
                                                        {skill.conflict && (
                                                            <span className="rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-[var(--warning)]">{t('agentSettings.skillDialogs.existsBadge')}</span>
                                                        )}
                                                        {skill.hasDangerousTools && (
                                                            <span className="rounded bg-[var(--error-bg)] px-1.5 py-0.5 text-[var(--error)]">{t('agentSettings.skillDialogs.bashPermissionBadge')}</span>
                                                        )}
                                                        {skill.conflict && (
                                                            <label className="ml-auto flex items-center gap-1 text-[var(--ink-muted)]">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={overwriteFolders.has(skill.suggestedFolderName)}
                                                                    onChange={() => toggleOverwrite(skill.suggestedFolderName)}
                                                                    onClick={e => e.stopPropagation()}
                                                                />
                                                                {t('agentSettings.skillDialogs.overwrite')}
                                                            </label>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </label>
                        ))}
                    </div>
                )}

                {preview && preview.mode === 'multi' && (
                    <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
                        <p className="text-sm text-[var(--ink-muted)]">{t('agentSettings.skillDialogs.multiSkillPrompt')}</p>
                        {preview.candidates.map(c => (
                            <div
                                key={c.suggestedFolderName}
                                className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-3"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedFolders.has(c.suggestedFolderName)}
                                    onChange={() => toggleFolder(c.suggestedFolderName)}
                                    className="mt-0.5"
                                />
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm text-[var(--ink)]">{c.suggestedFolderName}</span>
                                        {c.conflict && (
                                            <span className="rounded bg-[var(--warning-bg)] px-1.5 py-0.5 text-xs text-[var(--warning)]">{t('agentSettings.skillDialogs.existsBadge')}</span>
                                        )}
                                        {c.hasDangerousTools && (
                                            <span className="rounded bg-[var(--error-bg)] px-1.5 py-0.5 text-xs text-[var(--error)]">{t('agentSettings.skillDialogs.bashPermissionBadge')}</span>
                                        )}
                                    </div>
                                    {c.description && <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{c.description}</p>}
                                    <p className="mt-0.5 font-mono text-xs text-[var(--ink-muted)]/70">{c.rootPath}</p>
                                    {c.conflict && (
                                        <label className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                                            <input
                                                type="checkbox"
                                                checked={overwriteFolders.has(c.suggestedFolderName)}
                                                onChange={() => toggleOverwrite(c.suggestedFolderName)}
                                            />
                                            {t('agentSettings.skillDialogs.overwriteExistingSkill')}
                                        </label>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {preview && preview.mode === 'single-conflict' && (
                    <div className="mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-4">
                        <p className="text-sm font-medium text-[var(--ink)]">
                            {t('agentSettings.skillDialogs.skillExistsPrefix')}
                            <span className="font-mono">{preview.skill.suggestedFolderName}</span>
                            {t('agentSettings.skillDialogs.skillExistsSuffix')}
                        </p>
                        {preview.skill.description && (
                            <p className="mt-1 text-xs text-[var(--ink-muted)]">{preview.skill.description}</p>
                        )}
                        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
                            <input
                                type="checkbox"
                                checked={overwriteFolders.has(preview.skill.suggestedFolderName)}
                                onChange={() => toggleOverwrite(preview.skill.suggestedFolderName)}
                            />
                            {t('agentSettings.skillDialogs.overwriteCurrentVersion')}
                        </label>
                    </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] disabled:opacity-50"
                    >
                        {t('agentSettings.common.cancel')}
                    </button>
                    {!preview ? (
                        <button
                            type="button"
                            onClick={handleProbe}
                            disabled={!url.trim() || loading}
                            className="flex items-center gap-2 rounded-lg bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            {t('agentSettings.skillDialogs.probe')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={loading}
                            className="flex items-center gap-2 rounded-lg bg-[var(--button-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            {t('agentSettings.skillDialogs.install')}
                        </button>
                    )}
                </div>
            </div>
        </OverlayBackdrop>
    );
}

import { useContext, type ReactNode } from 'react';
import { Globe, Link as LinkIcon, Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFileAction, useFileTargetInfo } from '@/context/fileActionState';
import { useOpenWebLink } from '@/context/BrowserPanelContext';
import { resolveDocumentFileLink, resolveFileLinkTarget, resolveAgainstWorkspace } from '@/utils/workspaceFileLinks';
import { classifyInlineCodeTarget } from '@/utils/pathDetection';
import { FileIcon } from '@/components/file-icon';
import Tip from '@/components/Tip';
import { isAudioPath } from '@/utils/audioPlayer';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { MarkdownDocumentDirectoryContext, MarkdownLinkLabelContext } from './linkContext';

export const INLINE_CODE_CLASS = 'rounded bg-[var(--paper-inset)]/40 px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--ink)]';

/** One target powers the affordance, tooltip, preview and context menu. */
export default function ContentLink({ reference, displayReference = reference, native = false, basePath, children, ...props }: {
  reference: string;
  displayReference?: string;
  native?: boolean;
  basePath?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<'a'>, 'href' | 'children'>) {
  const { t } = useTranslation('app');
  const directory = useContext(MarkdownDocumentDirectoryContext);
  const insideLink = useContext(MarkdownLinkLabelContext);
  const fileAction = useFileAction();
  const openWebLink = useOpenWebLink();
  const classification = classifyInlineCodeTarget(reference);
  const web = classification.kind === 'web';
  const base = basePath ?? directory;
  const nativeRelative = !/^(?:[\\/]|~[\\/]|[A-Za-z]:[\\/]|[a-z][a-z\d+.-]*:\/\/)/i.test(reference);
  const rebased = native
    ? (base && nativeRelative ? `${base}/${reference}` : reference)
    : resolveDocumentFileLink(reference, base);
  const target = !insideLink && !web && (!native || classification.kind === 'file')
    ? resolveFileLinkTarget(rebased, fileAction?.workspacePath, native ? 'native' : 'url')
    : null;
  const info = useFileTargetInfo(target);
  const fullPath = target && (info?.resolvedPath ?? (target.scope === 'local' ? target.path : resolveAgainstWorkspace(target.path, fileAction?.workspacePath)));
  const address = displayReference;
  const status = target && !info?.exists ? t(info?.error ? 'fileActions.checkFailed' : info ? 'fileActions.targetUnavailable' : 'fileActions.checking') : '';
  const plain = native && (insideLink || (!web && (!target || !fileAction || (!info?.exists && !info?.error))));
  if (!reference.trim()) return <MarkdownLinkLabelContext.Provider value><span>{children}</span></MarkdownLinkLabelContext.Provider>;
  if (insideLink) return <code className="font-mono">{children}</code>;
  const label = native ? <code className={plain ? INLINE_CODE_CLASS : 'cursor-pointer font-mono'}>{children}</code> : children;
  if (plain) return <span onMouseEnter={() => { if (target && info && !info.exists) fileAction?.refreshFileTarget(target); }}>{label}</span>;
  const fileName = (fullPath ?? target?.path ?? '').split(/[\\/]/).pop() ?? '';
  return (
    <><Tip label={address} shortcut={status || undefined} wrap className="!inline">
      <a
        {...props}
        href={native && !web ? undefined : reference}
        role="link"
        tabIndex={0}
        className="markdown-content-link text-[var(--accent-warm)] no-underline hover:text-[var(--accent-warm-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const selection = window.getSelection();
          if (selection?.toString() && (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))) return;
          if (target && fileAction) fileAction.openFileTarget(target, { displayPath: displayReference, forceExternal: event.metaKey || event.ctrlKey });
          else if (!target) openWebLink(reference, { forceExternal: event.metaKey || event.ctrlKey });
        }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.currentTarget.hasAttribute('href')) event.currentTarget.click(); }}
        onContextMenu={(event) => {
          if (!target || !fileAction) return;
          event.preventDefault(); event.stopPropagation();
          fileAction.openFileTargetMenu(event.clientX, event.clientY, target, { displayPath: displayReference });
        }}
      >
        {target ? <FileIcon name={fileName} nodeKind={info?.type === 'dir' ? 'directory' : 'file'} size="inline" className="!my-0 mr-[0.25em] !inline-block" />
          : web ? <Globe aria-hidden className="mr-[0.25em] inline size-[1em] align-[-0.125em]" /> : <LinkIcon aria-hidden className="mr-[0.25em] inline size-[1em] align-[-0.125em]" />}
        <MarkdownLinkLabelContext.Provider value>{label}</MarkdownLinkLabelContext.Provider>
      </a>
    </Tip>{native && info?.exists && fullPath && isAudioPath(fullPath) && <AudioPlayButton filePath={fullPath} />}</>
  );
}


function AudioPlayButton({ filePath }: { filePath: string }) {
  const { t } = useTranslation('app');
  const { isPlaying, toggle } = useAudioPlayer(filePath);
  return <button type="button" onClick={event => { event.preventDefault(); event.stopPropagation(); toggle(); }}
    className="ml-1 inline-flex size-[18px] items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] align-middle"
    aria-label={isPlaying ? t('inlineCode.pause') : t('inlineCode.playAudio')}>
    {isPlaying ? <Pause className="size-2.5 fill-current" /> : <Play className="size-2.5 fill-current" />}
  </button>;
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolUseSimple } from '@/types/chat';
import { CollapsibleTool } from './CollapsibleTool';
import { ToolHeader } from './utils';
import { useImagePreview } from '@/context/ImagePreviewContext';
import { readLocalFileAsBlobUrl } from '@/utils/audioPlayer';
import { parseGeminiImageResult, imageMimeFromPath } from '../../../shared/builtinMediaResult';

interface GeminiImageToolProps {
  tool: ToolUseSimple;
}

export default function GeminiImageTool({ tool }: GeminiImageToolProps) {
  const { t } = useTranslation('chat');
  // PRD 0.2.31 — shared single-source parser (server + this card use the same one).
  const parsed = parseGeminiImageResult(tool.result);
  const { openPreview } = useImagePreview();
  // PRD 0.2.30 — when the image is surfaced via the first-class attachment
  // pipeline (ToolAttachmentGallery renders it in-flow below this card), the card
  // shows meta only. Older history results carry no attachments → keep the
  // embedded image as a legacy fallback.
  const hasAttachments = (tool.attachments?.length ?? 0) > 0;
  // Use key-based reset instead of useEffect setState to avoid cascading renders
  const resultKey = tool.result ?? '';
  const [imageState, setImageState] = useState<{ loaded: boolean; error: boolean; key: string }>({ loaded: false, error: false, key: resultKey });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Reset when result changes (via key comparison, not effect)
  const imageLoaded = imageState.key === resultKey ? imageState.loaded : false;
  const imageError = imageState.key === resultKey ? imageState.error : false;

  // Resolve image URL (blob URL in Tauri, direct URL in browser)
  useEffect(() => {
    if (!parsed.filePath || hasAttachments) {
      // No filePath, or the image is rendered by ToolAttachmentGallery instead —
      // skip the blob resolution to avoid a wasted read + leaked object URL.
      // Use rAF to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => setImageUrl(null));
      return () => cancelAnimationFrame(id);
    }
    const filePath = parsed.filePath;
    let cancelled = false;

    readLocalFileAsBlobUrl(filePath, imageMimeFromPath(filePath), '/api/image')
      .then(url => {
        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        // Revoke previous blob URL
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url.startsWith('blob:') ? url : null;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageState({ loaded: false, error: true, key: resultKey });
      });

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [parsed.filePath, resultKey, hasAttachments]);

  const toolLabel = tool.name.includes('edit_image') ? t('shell.toolChrome.labels.editImage') : t('shell.toolChrome.labels.generateImage');
  const isGenerating = !tool.result;

  const handleImageClick = useCallback(() => {
    if (imageUrl) {
      openPreview(imageUrl, parsed.filePath?.split('/').pop() || 'image.png');
    }
  }, [imageUrl, parsed.filePath, openPreview]);

  const collapsedContent = (
    <div className="flex items-center gap-1.5">
      <ToolHeader tool={tool} toolName={tool.name} label={toolLabel} />
      {isGenerating && (
        <span className="text-xs text-[var(--ink-muted)] animate-pulse">{t('shell.toolChrome.geminiImage.generating')}</span>
      )}
      {parsed.isEdit && parsed.editCount && (
        <span className="rounded bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs text-[var(--ink-muted)]">
          #{parsed.editCount}
        </span>
      )}
      {parsed.description && (
        <span className="truncate text-xs text-[var(--ink-muted)] max-w-[300px]">
          {parsed.description}
        </span>
      )}
    </div>
  );

  const expandedContent = (
    <div className="space-y-2 mt-1">
      {/* Parameters */}
      {tool.inputJson && (
        <div className="text-xs text-[var(--ink-muted)] font-mono">
          {(() => {
            try {
              const input = JSON.parse(tool.inputJson);
              return (
                <div className="space-y-0.5">
                  {input.prompt && <div><span className="opacity-60">prompt:</span> {input.prompt}</div>}
                  {input.instruction && <div><span className="opacity-60">instruction:</span> {input.instruction}</div>}
                  {input.contextId && <div><span className="opacity-60">contextId:</span> {input.contextId}</div>}
                  {input.aspectRatio && <div><span className="opacity-60">aspectRatio:</span> {input.aspectRatio}</div>}
                  {input.resolution && <div><span className="opacity-60">resolution:</span> {input.resolution}</div>}
                </div>
              );
            } catch {
              return <pre className="break-words whitespace-pre-wrap">{tool.inputJson}</pre>;
            }
          })()}
        </div>
      )}

      {/* Image display — legacy fallback only (no attachments). New results render
          in-flow via ToolAttachmentGallery → ToolImageAttachment below the card. */}
      {parsed.filePath && !parsed.error && !hasAttachments && (
        <div className="mt-2">
          <div
            className="relative cursor-pointer group rounded-lg overflow-hidden inline-block border border-[var(--line-subtle)]"
            onClick={handleImageClick}
          >
            {!imageLoaded && !imageError && (
              <div className="w-[300px] h-[200px] bg-[var(--paper-inset)] animate-pulse rounded-lg flex items-center justify-center">
                <span className="text-xs text-[var(--ink-muted)]">{t('shell.toolChrome.geminiImage.loading')}</span>
              </div>
            )}
            {imageError && (
              <div className="w-[300px] h-[200px] bg-[var(--paper-inset)] rounded-lg flex items-center justify-center">
                <span className="text-xs text-[var(--error)]">{t('shell.toolChrome.geminiImage.loadFailed')}</span>
              </div>
            )}
            {imageUrl && (
              <img
                src={imageUrl}
                alt={parsed.description || toolLabel}
                className={`max-w-[400px] max-h-[400px] rounded-lg transition-opacity ${imageLoaded ? 'opacity-100' : 'opacity-0 absolute'}`}
                onLoad={() => setImageState({ loaded: true, error: false, key: resultKey })}
                onError={() => setImageState({ loaded: false, error: true, key: resultKey })}
              />
            )}
            {imageLoaded && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 text-white text-xs bg-black/50 px-2 py-1 rounded transition-opacity">
                  {t('shell.toolChrome.geminiImage.zoom')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      {parsed.contextId && (
        <div className="text-xs text-[var(--ink-muted)] space-y-0.5 mt-1">
          {parsed.resolution && <div>{t('shell.toolChrome.geminiImage.resolution')}: {parsed.resolution} {parsed.aspectRatio && `| ${t('shell.toolChrome.geminiImage.aspectRatio')}: ${parsed.aspectRatio}`}</div>}
          {parsed.model && <div>{t('shell.toolChrome.geminiImage.model')}: {parsed.model}</div>}
          {parsed.filePath && <div className="font-mono opacity-60 break-all">{t('shell.toolChrome.geminiImage.file')}: {parsed.filePath}</div>}
          <div className="font-mono opacity-60">contextId: {parsed.contextId}</div>
        </div>
      )}

      {/* Error display */}
      {parsed.error && (
        <pre className="overflow-x-auto rounded bg-[var(--error-bg)] px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap text-[var(--error)]">
          {parsed.error}
        </pre>
      )}

      {/* Description from Gemini */}
      {parsed.description && !parsed.error && (
        <div className="text-xs text-[var(--ink-secondary)] mt-1">
          {parsed.description}
        </div>
      )}
    </div>
  );

  return <CollapsibleTool collapsedContent={collapsedContent} expandedContent={expandedContent} />;
}

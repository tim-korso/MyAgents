import type { ToolUseSimple } from '@/types/chat';
import { useTranslation } from 'react-i18next';
import { CollapsibleTool } from './CollapsibleTool';
import { ToolHeader } from './utils';
import AudioPlayerBar from './AudioPlayerBar';
import { parseEdgeTtsResult } from '../../../shared/builtinMediaResult';

interface EdgeTtsToolProps {
  tool: ToolUseSimple;
}

export default function EdgeTtsTool({ tool }: EdgeTtsToolProps) {
  const { t } = useTranslation('chat');
  // PRD 0.2.31 — shared single-source parser (server + this card use the same one).
  const parsed = parseEdgeTtsResult(tool.result);

  const isListVoices = tool.name.includes('list_voices');
  const toolLabel = isListVoices ? t('shell.toolChrome.labels.listVoices') : t('shell.toolChrome.labels.textToSpeech');
  const isGenerating = !tool.result;

  // PRD 0.2.30 — when the audio is surfaced via the first-class attachment
  // pipeline (ToolAttachmentGallery renders the player in-flow below this card),
  // the card keeps meta + file path only. Older history results carry no
  // attachments → keep the embedded player as a legacy fallback.
  const hasAttachments = (tool.attachments?.length ?? 0) > 0;

  const collapsedContent = (
    <div className="flex items-center gap-1.5">
      <ToolHeader tool={tool} toolName={tool.name} label={toolLabel} />
      {isGenerating && (
        <span className="text-xs text-[var(--ink-muted)] animate-pulse">
          {isListVoices ? t('shell.toolChrome.tts.querying') : t('shell.toolChrome.tts.generating')}
        </span>
      )}
      {parsed.voice && (
        <span className="rounded bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs text-[var(--ink-muted)] font-mono">
          {parsed.voice}
        </span>
      )}
      {parsed.duration && (
        <span className="text-xs text-[var(--ink-muted)]">{parsed.duration}</span>
      )}
      {parsed.textPreview && (
        <span className="truncate text-xs text-[var(--ink-muted)] max-w-[300px]">
          {parsed.textPreview}
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
                  {input.text && (
                    <div>
                      <span className="opacity-60">text:</span>{' '}
                      {input.text.length > 100 ? input.text.substring(0, 100) + '...' : input.text}
                    </div>
                  )}
                  {input.voice && <div><span className="opacity-60">voice:</span> {input.voice}</div>}
                  {input.rate && <div><span className="opacity-60">rate:</span> {input.rate}</div>}
                  {input.volume && <div><span className="opacity-60">volume:</span> {input.volume}</div>}
                  {input.pitch && <div><span className="opacity-60">pitch:</span> {input.pitch}</div>}
                  {input.language && <div><span className="opacity-60">language:</span> {input.language}</div>}
                  {input.gender && <div><span className="opacity-60">gender:</span> {input.gender}</div>}
                </div>
              );
            } catch {
              return <pre className="break-words whitespace-pre-wrap">{tool.inputJson}</pre>;
            }
          })()}
        </div>
      )}

      {/* Audio player — legacy fallback only (no attachments). New results play
          in-flow via ToolAttachmentGallery → ToolAudioAttachment below the card. */}
      {parsed.filePath && !parsed.error && !hasAttachments && (
        <div className="mt-2">
          <AudioPlayerBar filePath={parsed.filePath} />
        </div>
      )}

      {/* Metadata */}
      {parsed.filePath && !parsed.error && (
        <div className="text-xs text-[var(--ink-muted)] space-y-0.5 mt-1">
          {parsed.voice && <div>{t('shell.toolChrome.tts.voice')}: {parsed.voice}</div>}
          {parsed.duration && <div>{t('shell.toolChrome.tts.duration')}: {parsed.duration}</div>}
          {parsed.format && parsed.size && <div>{t('shell.toolChrome.tts.format')}: {parsed.format} | {t('shell.toolChrome.tts.size')}: {parsed.size}</div>}
          {parsed.rate && parsed.rate !== '0%' && <div>{t('shell.toolChrome.tts.rate')}: {parsed.rate}</div>}
          {parsed.volume && parsed.volume !== '0%' && <div>{t('shell.toolChrome.tts.volume')}: {parsed.volume}</div>}
          {parsed.pitch && parsed.pitch !== '+0Hz' && <div>{t('shell.toolChrome.tts.pitch')}: {parsed.pitch}</div>}
          <div className="font-mono opacity-60 break-all">{t('shell.toolChrome.tts.file')}: {parsed.filePath}</div>
        </div>
      )}

      {/* Voice list result */}
      {parsed.isVoiceList && tool.result && (
        <pre className="overflow-x-auto overflow-y-auto max-h-[300px] rounded bg-[var(--paper-inset)]/50 px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-[var(--ink-secondary)]">
          {tool.result}
        </pre>
      )}

      {/* Error display */}
      {parsed.error && (
        <pre className="overflow-x-auto rounded bg-[var(--error-bg)] px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap text-[var(--error)]">
          {parsed.error}
        </pre>
      )}
    </div>
  );

  return <CollapsibleTool collapsedContent={collapsedContent} expandedContent={expandedContent} />;
}

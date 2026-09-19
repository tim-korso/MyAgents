import { Image as ImageIcon, Video, AudioLines } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tip from '@/components/Tip';

/**
 * Small inline icon row that shows which non-text modalities a model accepts.
 *
 * Renders nothing for text-only models — the **absence** of a badge is the
 * "this is a text-only model" signal. Keeping the model picker lean for the
 * common case (most models) and only flagging the special-capability ones
 * was an explicit product call (see PRD note: "只展示图片吧，就是图片音频
 * 这种有这种额外模态的时候，你给他就打上标签").
 *
 * **Modality rendering scope (V1):** only `image` is rendered. Video and
 * audio are wired (lucide icons + tooltips) but each lives behind its own
 * feature flag — `RENDER_VIDEO_BADGES` and `RENDER_AUDIO_BADGES` — so they
 * can be lit up independently as Anthropic adds the corresponding block
 * types (the two are likely to land on different timelines).
 *
 * Why audio/video aren't rendered today, even when the model claims to
 * support them:
 *   - Claude Agent SDK's `ContentBlockParam` union (see
 *     `@anthropic-ai/sdk/resources/messages/messages.d.ts:439`) is
 *     `TextBlockParam | ImageBlockParam | DocumentBlockParam | …` — no
 *     audio or video block types exist.
 *   - claude-code itself only handles `audio` on the MCP tool-RESULT path
 *     (it's persisted to a blob + replaced with a text reference), never on
 *     the user-INPUT path. Image is the only non-text input modality the
 *     entire stack can carry today.
 *   - The OpenAI bridge translates SDK content blocks → OpenAI format; if
 *     the SDK can't emit an audio/video block, the bridge has nothing to
 *     forward — so even Gemini / Doubao models that natively accept those
 *     can't receive them through our chain.
 *
 * Showing badges for capabilities the chain can't deliver is a false
 * promise. The data is intentionally still populated on each preset model
 * (see `PRESET_PROVIDERS`) so flipping a flag once SDK gains the
 * corresponding block type is a one-line change with no re-research.
 *
 * To enable when SDK support arrives:
 *   1. Verify `ContentBlockParam` in
 *      `@anthropic-ai/sdk/resources/messages/messages.d.ts` lists the new
 *      block (look for `VideoBlockParam` / `AudioBlockParam` or similar).
 *   2. Wire the new block in `agent-session.ts::enqueueUserMessage` content
 *      construction + `stripUnsupportedModalityBlocks` re-strip path.
 *   3. Flip the flag below.
 */
const RENDER_VIDEO_BADGES = false;
const RENDER_AUDIO_BADGES = false;

export function ModalityBadges({
  modalities,
  className = '',
  iconSize = 'h-3 w-3',
}: {
  modalities?: string[];
  /** Extra classes for the wrapper. Defaults to muted ink color + small gap. */
  className?: string;
  /** Icon size class (default `h-3 w-3` for the picker; pass larger for status bars). */
  iconSize?: string;
}) {
  const { t } = useTranslation('app');
  if (!modalities || modalities.length === 0) return null;
  const items: Array<{ key: string; label: string; Icon: typeof ImageIcon }> = [];
  if (modalities.includes('image')) items.push({ key: 'image', label: t('modalities.image'), Icon: ImageIcon });
  if (RENDER_VIDEO_BADGES && modalities.includes('video')) items.push({ key: 'video', label: t('modalities.video'), Icon: Video });
  if (RENDER_AUDIO_BADGES && modalities.includes('audio')) items.push({ key: 'audio', label: t('modalities.audio'), Icon: AudioLines });
  if (items.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[var(--ink-muted)]/70 ${className}`}>
      {items.map(({ key, label, Icon }) => (
        <Tip key={key} label={t('modalityBadges.supportsInput', { modality: label })} position="top">
          <Icon className={iconSize} aria-label={t('modalityBadges.supportsInput', { modality: label })} />
        </Tip>
      ))}
    </span>
  );
}

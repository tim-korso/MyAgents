/**
 * Reading the thinking channel out of an OpenAI-compatible payload.
 *
 * Providers do not agree on the field name. The convention most OpenAI-compatible
 * servers follow is `reasoning_content`, but DeepSeek sends `reasoning` instead —
 * verified against the live endpoint, whose response message carries exactly
 * `role, content, reasoning, reasoning_details` and no `reasoning_content` key.
 *
 * Only `reasoning_content` was read, so every DeepSeek thinking token was
 * dropped before it reached the UI: the model reasoned, the user saw nothing, and
 * no error was raised. Centralizing the lookup keeps the streaming and
 * non-streaming paths from diverging again.
 */

/**
 * Extract thinking text from a message or delta object, or `undefined` when the
 * payload carries none.
 *
 * `reasoning_content` wins when both are present: it is the documented
 * convention, and a payload carrying both is most likely one that echoes a
 * normalized form alongside a vendor extension.
 *
 * `reasoning_details` is deliberately NOT used as a fallback. It is a structured
 * transcription of the same content (an array of `{type, text, index}`), so
 * reading it as well would emit every token twice whenever a provider sends both.
 */
export function extractReasoningText(
  source: { reasoning_content?: unknown; reasoning?: unknown } | null | undefined,
): string | undefined {
  if (!source) return undefined;
  const primary = source.reasoning_content;
  if (typeof primary === 'string' && primary.length > 0) return primary;
  const fallback = source.reasoning;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return undefined;
}

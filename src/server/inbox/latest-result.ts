import type { SessionMessage } from '../types/session';

export const NO_TEXT_RESPONSE = '(no text response)';

interface PersistedTextBlock {
  type?: string;
  text?: unknown;
}

export function extractAssistantTextFromStoredContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as PersistedTextBlock[];
      if (Array.isArray(parsed)) {
        const text = parsed
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text as string)
          .join('');
        if (text.trim()) return text;
      }
    } catch {
      // Fall through to plain string content.
    }
  }

  return content;
}

export function getLatestAssistantResultFromMessages(messages: readonly SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== 'assistant') continue;
    const text = extractAssistantTextFromStoredContent(msg.content).trim();
    return text || NO_TEXT_RESPONSE;
  }
  return NO_TEXT_RESPONSE;
}

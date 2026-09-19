/**
 * chatSendKey — single source of truth for "Enter sends or inserts a newline"
 * across every AI-conversation composer (main chat box, AI 小助理, 问题反馈).
 *
 * Pure logic only — no DOM, no React — so it is trivially unit-testable and
 * shared by both the complex main-box keydown handler (SimpleChatInput) and the
 * `useChatComposerKeydown` hook used by the simpler composers.
 *
 * The user's preference lives in `AppConfig.chatSendShortcut` (undefined ⇒
 * 'enter', preserving the historical default).
 */

import { i18n } from '@/i18n';

/** How a plain/modified Enter is interpreted in a chat composer. */
export type ChatSendShortcut = 'enter' | 'modEnter';

/** The modifier flags read off a keyboard event (structural — React or native). */
export interface EnterKeyModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * Decide whether an Enter keypress should send the message or insert a newline,
 * given the user's send-key preference.
 *
 * - `'enter'` (default): a bare Enter sends; Shift+Enter and ⌘/Ctrl+Enter newline.
 * - `'modEnter'`        : ⌘/Ctrl+Enter sends; bare Enter and Shift+Enter newline.
 *
 * Callers MUST first rule out IME composition (`imeKeyboard.isImeComposingEvent`)
 * — a CJK candidate-commit arrives as Enter and must never send (cf. #123).
 */
export function resolveEnterKeyAction(
  mods: EnterKeyModifiers,
  pref: ChatSendShortcut,
): 'send' | 'newline' {
  const modHeld = mods.metaKey || mods.ctrlKey;
  if (pref === 'modEnter') {
    // Any ⌘/Ctrl+Enter sends (Shift state irrelevant); everything else newlines.
    return modHeld ? 'send' : 'newline';
  }
  // 'enter': only a truly bare Enter sends.
  return !mods.shiftKey && !modHeld ? 'send' : 'newline';
}

/**
 * Structured send hint (label + shortcut chip) for the chosen preference and
 * platform. Drives tooltips so the affordance text always matches behavior.
 */
export function sendKeyHint(
  pref: ChatSendShortcut,
  isMac: boolean,
): { label: string; shortcut: string } {
  const mod = isMac ? '⌘' : 'Ctrl';
  return {
    label: String(i18n.t('chat:input.send')),
    shortcut: pref === 'modEnter' ? `${mod} Enter` : 'Enter',
  };
}

/** Flat `发送 (Enter)` / `发送 (⌘ Enter)` string for `title=` attributes. */
export function sendHintLabel(pref: ChatSendShortcut, isMac: boolean): string {
  const { label, shortcut } = sendKeyHint(pref, isMac);
  return `${label} (${shortcut})`;
}

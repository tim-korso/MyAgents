import { isImeComposingEvent } from '@/utils/imeKeyboard';
/**
 * useChatComposerKeydown — Enter-to-send handling for "simple" AI-conversation
 * composers (AI 小助理 / 问题反馈) that have no other keydown concerns.
 *
 * Returns the three textarea handlers to spread. It is the single source of
 * truth with the main chat box: both consult `resolveEnterKeyAction` +
 * `isImeComposingEvent` (@/utils/imeKeyboard). This hook additionally owns the
 * IME composition ref these surfaces previously lacked — a latent CJK mis-send
 * bug (cf. #123), now fixed for free by adopting the shared path.
 *
 * `onSend` is expected to self-guard (no-op when there's nothing to send); on a
 * resolved "send" we always preventDefault (suppress the newline) then call it,
 * matching SimpleChatInput's established semantics.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useConfigData } from '@/config/useConfigData';
import {
  resolveEnterKeyAction,
  type ChatSendShortcut,
} from '@/utils/chatSendKey';

export interface ChatComposerHandlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  /** Resolved preference — exposed so callers can render a matching send hint. */
  sendShortcut: ChatSendShortcut;
}

export function useChatComposerKeydown(onSend: () => void): ChatComposerHandlers {
  const { config } = useConfigData();
  const sendShortcut: ChatSendShortcut = config.chatSendShortcut ?? 'enter';

  // Refs keep the returned handlers referentially stable while always seeing
  // the latest preference / callback (React-stability rules — no stale closures).
  const prefRef = useRef(sendShortcut);
  const onSendRef = useRef(onSend);
  const isComposingRef = useRef(false);

  useEffect(() => {
    prefRef.current = sendShortcut;
    onSendRef.current = onSend;
  }, [sendShortcut, onSend]);

  const onCompositionStart = useCallback(() => { isComposingRef.current = true; }, []);
  const onCompositionEnd = useCallback(() => { isComposingRef.current = false; }, []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // IME guard: ref (covers the keydown-before-compositionend race) + the
    // standard/legacy event flags.
    if (isComposingRef.current || isImeComposingEvent(e)) return;
    if (resolveEnterKeyAction(e, prefRef.current) !== 'send') return; // newline → let the browser insert it
    e.preventDefault();
    onSendRef.current();
  }, []);

  return { onKeyDown, onCompositionStart, onCompositionEnd, sendShortcut };
}

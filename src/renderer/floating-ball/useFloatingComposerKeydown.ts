import { isImeComposingEvent } from '@/utils/imeKeyboard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CompositionEvent, type KeyboardEvent } from 'react';

import { resolveEnterKeyAction, type ChatSendShortcut } from '@/utils/chatSendKey';
import { handleSelectAllKeydown } from '@/utils/selectAllRouter';

interface FloatingComposerKeydownOptions {
    sendShortcut: ChatSendShortcut;
    onSend: () => void | Promise<void>;
    onEscape: () => void;
    onCompositionEndResize?: (el: HTMLTextAreaElement) => void;
}

export interface FloatingComposerKeydownHandlers {
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: (e: CompositionEvent<HTMLTextAreaElement>) => void;
    isComposing: () => boolean;
}

function isMacPlatform(): boolean {
    return typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
}

/**
 * Keyboard owner for the floating companion composer.
 *
 * Window-level shortcuts live here because fb-companion is an isolated WebView
 * and does not mount App.tsx, where the main-window shortcut router lives.
 */
export function useFloatingComposerKeydown({
    sendShortcut,
    onSend,
    onEscape,
    onCompositionEndResize,
}: FloatingComposerKeydownOptions): FloatingComposerKeydownHandlers {
    const isComposingRef = useRef(false);
    const sendShortcutRef = useRef(sendShortcut);
    const onSendRef = useRef(onSend);
    const onEscapeRef = useRef(onEscape);
    const onCompositionEndResizeRef = useRef(onCompositionEndResize);

    useLayoutEffect(() => {
        sendShortcutRef.current = sendShortcut;
        onSendRef.current = onSend;
        onEscapeRef.current = onEscape;
        onCompositionEndResizeRef.current = onCompositionEndResize;
    }, [onCompositionEndResize, onEscape, onSend, sendShortcut]);

    useEffect(() => {
        const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
            if (isComposingRef.current || isImeComposingEvent(event)) return;
            if (handleSelectAllKeydown(event, isMacPlatform())) return;
            if (event.key === 'Escape') onEscapeRef.current();
        };
        window.addEventListener('keydown', onWindowKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onWindowKeyDown, { capture: true });
    }, []);

    const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter') return;
        if (isComposingRef.current || isImeComposingEvent(e)) return;
        if (resolveEnterKeyAction(e, sendShortcutRef.current) !== 'send') return;
        e.preventDefault();
        void onSendRef.current();
    }, []);

    const onCompositionStart = useCallback(() => {
        isComposingRef.current = true;
    }, []);

    const onCompositionEnd = useCallback((e: CompositionEvent<HTMLTextAreaElement>) => {
        isComposingRef.current = false;
        onCompositionEndResizeRef.current?.(e.currentTarget);
    }, []);

    const isComposing = useCallback(() => isComposingRef.current, []);

    return useMemo(() => ({
        onKeyDown,
        onCompositionStart,
        onCompositionEnd,
        isComposing,
    }), [isComposing, onCompositionEnd, onCompositionStart, onKeyDown]);
}

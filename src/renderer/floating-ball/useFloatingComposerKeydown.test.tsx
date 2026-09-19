import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatSendShortcut } from '@/utils/chatSendKey';
import { useFloatingComposerKeydown } from './useFloatingComposerKeydown';

function Harness({
    sendShortcut = 'enter',
    onSend,
    onEscape = () => undefined,
    onResize = () => undefined,
}: {
    sendShortcut?: ChatSendShortcut;
    onSend: () => void;
    onEscape?: () => void;
    onResize?: (el: HTMLTextAreaElement) => void;
}) {
    const composer = useFloatingComposerKeydown({
        sendShortcut,
        onSend,
        onEscape,
        onCompositionEndResize: onResize,
    });
    return (
        <textarea
            data-testid="composer"
            defaultValue="hello mino"
            onKeyDown={composer.onKeyDown}
            onCompositionStart={composer.onCompositionStart}
            onCompositionEnd={composer.onCompositionEnd}
        />
    );
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('useFloatingComposerKeydown', () => {
    it.each([{ isComposing: true, keyCode: 27 }, { isComposing: false, keyCode: 229 }])('keeps the companion open during composition Escape: %j', ime => {
        const onEscape = vi.fn();
        render(<Harness onSend={vi.fn()} onEscape={onEscape} />);
        const textarea = screen.getByTestId('composer');
        fireEvent.keyDown(textarea, { key: 'Escape', ...ime });
        expect(onEscape).not.toHaveBeenCalled();
        fireEvent.keyDown(textarea, { key: 'Escape', keyCode: 27 });
        expect(onEscape).toHaveBeenCalledOnce();
    });

    it('selects focused textarea on Ctrl/Cmd+A via the window-level router', () => {
        render(<Harness onSend={vi.fn()} />);
        const textarea = screen.getByTestId('composer') as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(5, 5);

        const notPrevented = fireEvent.keyDown(window, {
            key: 'a',
            code: 'KeyA',
            ctrlKey: true,
            metaKey: true,
        });

        expect(notPrevented).toBe(false);
        expect(textarea.selectionStart).toBe(0);
        expect(textarea.selectionEnd).toBe('hello mino'.length);
    });

    it('bare Enter sends for enter preference and prevents newline', () => {
        const onSend = vi.fn();
        render(<Harness sendShortcut="enter" onSend={onSend} />);

        const notPrevented = fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Enter', keyCode: 13 });

        expect(notPrevented).toBe(false);
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Enter sends for modEnter preference while bare Enter stays native', () => {
        const onSend = vi.fn();
        render(<Harness sendShortcut="modEnter" onSend={onSend} />);
        const textarea = screen.getByTestId('composer');

        expect(fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 })).toBe(true);
        expect(onSend).not.toHaveBeenCalled();

        expect(fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13, ctrlKey: true })).toBe(false);
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('blocks Enter sends while composing and resumes after compositionEnd', () => {
        const onSend = vi.fn();
        const onResize = vi.fn();
        render(<Harness onSend={onSend} onResize={onResize} />);
        const textarea = screen.getByTestId('composer') as HTMLTextAreaElement;

        fireEvent.compositionStart(textarea);
        fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 });
        expect(onSend).not.toHaveBeenCalled();

        fireEvent.compositionEnd(textarea);
        expect(onResize).toHaveBeenCalledWith(textarea);
        fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('routes Escape through the window-level handler and cleans it up on unmount', () => {
        const onEscape = vi.fn();
        const { unmount } = render(<Harness onSend={vi.fn()} onEscape={onEscape} />);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);

        unmount();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);
    });
});

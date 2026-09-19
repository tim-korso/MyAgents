import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSendShortcut } from '@/utils/chatSendKey';

// Mutable preference the mocked config returns. `undefined` exercises the
// real existing-user path (no chatSendShortcut key on disk ⇒ defaults to 'enter').
const state = vi.hoisted(() => ({ pref: 'enter' as ChatSendShortcut | undefined }));

vi.mock('@/config/useConfigData', () => ({
  useConfigData: () => ({ config: { chatSendShortcut: state.pref } }),
}));

import { useChatComposerKeydown } from './useChatComposerKeydown';

function Harness({ onSend }: { onSend: () => void }) {
  const { onKeyDown, onCompositionStart, onCompositionEnd } = useChatComposerKeydown(onSend);
  return (
    <textarea
      data-testid="composer"
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
    />
  );
}

/** fireEvent returns false when the handler called preventDefault (i.e. "send"). */
function press(opts: Record<string, unknown>): { sent: boolean; prevented: boolean } {
  const el = screen.getByTestId('composer');
  const notPrevented = fireEvent.keyDown(el, { key: 'Enter', keyCode: 13, ...opts });
  return { sent: !notPrevented, prevented: !notPrevented };
}

describe('useChatComposerKeydown', () => {
  let onSend: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onSend = vi.fn();
    state.pref = 'enter';
  });
  afterEach(() => vi.clearAllMocks());

  describe("'enter' preference", () => {
    beforeEach(() => { state.pref = 'enter'; render(<Harness onSend={onSend} />); });

    it('bare Enter sends and prevents the newline', () => {
      const { prevented } = press({});
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(prevented).toBe(true);
    });
    it('Shift+Enter inserts a newline (no send, not prevented)', () => {
      const { prevented } = press({ shiftKey: true });
      expect(onSend).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });
    it('Cmd+Enter inserts a newline', () => {
      press({ metaKey: true });
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("'modEnter' preference", () => {
    beforeEach(() => { state.pref = 'modEnter'; render(<Harness onSend={onSend} />); });

    it('bare Enter inserts a newline (no send)', () => {
      const { prevented } = press({});
      expect(onSend).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });
    it('Cmd+Enter sends', () => {
      press({ metaKey: true });
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    it('Ctrl+Enter sends', () => {
      press({ ctrlKey: true });
      expect(onSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('default fallback (existing users with no chatSendShortcut on disk)', () => {
    beforeEach(() => { state.pref = undefined; render(<Harness onSend={onSend} />); });

    it("undefined preference behaves as 'enter' — bare Enter sends", () => {
      const { prevented } = press({});
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(prevented).toBe(true);
    });
  });

  describe('IME composition guard', () => {
    beforeEach(() => { state.pref = 'enter'; render(<Harness onSend={onSend} />); });

    it('does not send while composing (compositionStart, no compositionEnd)', () => {
      const el = screen.getByTestId('composer');
      fireEvent.compositionStart(el);
      press({});
      expect(onSend).not.toHaveBeenCalled();
    });
    it('sends again after composition ends', () => {
      const el = screen.getByTestId('composer');
      fireEvent.compositionStart(el);
      fireEvent.compositionEnd(el);
      press({});
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    it('legacy keyCode 229 never sends', () => {
      press({ keyCode: 229 });
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});

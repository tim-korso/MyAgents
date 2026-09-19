import { isImeComposingEvent } from '@/utils/imeKeyboard';
import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import {
  resolveEnterKeyAction,
  sendHintLabel,
  sendKeyHint,
  type ChatSendShortcut,
} from './chatSendKey';

const mods = (over: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...over,
});

describe('resolveEnterKeyAction', () => {
  describe("'enter' (default) preference", () => {
    const pref: ChatSendShortcut = 'enter';
    it('bare Enter sends', () => {
      expect(resolveEnterKeyAction(mods(), pref)).toBe('send');
    });
    it('Shift+Enter inserts a newline', () => {
      expect(resolveEnterKeyAction(mods({ shiftKey: true }), pref)).toBe('newline');
    });
    it('Cmd+Enter inserts a newline', () => {
      expect(resolveEnterKeyAction(mods({ metaKey: true }), pref)).toBe('newline');
    });
    it('Ctrl+Enter inserts a newline', () => {
      expect(resolveEnterKeyAction(mods({ ctrlKey: true }), pref)).toBe('newline');
    });
  });

  describe("'modEnter' preference", () => {
    const pref: ChatSendShortcut = 'modEnter';
    it('bare Enter inserts a newline', () => {
      expect(resolveEnterKeyAction(mods(), pref)).toBe('newline');
    });
    it('Shift+Enter inserts a newline', () => {
      expect(resolveEnterKeyAction(mods({ shiftKey: true }), pref)).toBe('newline');
    });
    it('Cmd+Enter sends', () => {
      expect(resolveEnterKeyAction(mods({ metaKey: true }), pref)).toBe('send');
    });
    it('Ctrl+Enter sends', () => {
      expect(resolveEnterKeyAction(mods({ ctrlKey: true }), pref)).toBe('send');
    });
    it('Cmd+Shift+Enter still sends (modifier held)', () => {
      expect(resolveEnterKeyAction(mods({ metaKey: true, shiftKey: true }), pref)).toBe('send');
    });
  });
});

describe('isImeComposingEvent', () => {
  it('true when nativeEvent.isComposing', () => {
    expect(isImeComposingEvent({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true);
  });
  it('true on legacy keyCode 229', () => {
    expect(isImeComposingEvent({ nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true);
  });
  it('false for a real Enter not in composition', () => {
    expect(isImeComposingEvent({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  });
  it('handles missing isComposing flag', () => {
    expect(isImeComposingEvent({ nativeEvent: {}, keyCode: 13 })).toBe(false);
  });
});

describe('sendKeyHint / sendHintLabel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it("'enter' → Enter chip on both platforms", () => {
    expect(sendKeyHint('enter', true)).toEqual({ label: '发送', shortcut: 'Enter' });
    expect(sendKeyHint('enter', false)).toEqual({ label: '发送', shortcut: 'Enter' });
  });
  it("'modEnter' → ⌘ on mac, Ctrl elsewhere", () => {
    expect(sendKeyHint('modEnter', true).shortcut).toBe('⌘ Enter');
    expect(sendKeyHint('modEnter', false).shortcut).toBe('Ctrl Enter');
  });
  it('sendHintLabel composes label + shortcut', () => {
    expect(sendHintLabel('enter', true)).toBe('发送 (Enter)');
    expect(sendHintLabel('modEnter', true)).toBe('发送 (⌘ Enter)');
    expect(sendHintLabel('modEnter', false)).toBe('发送 (Ctrl Enter)');
  });
});

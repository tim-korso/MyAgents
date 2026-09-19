import { describe, expect, it } from 'vitest';

import { resolveSelectAllTarget, type SelectAllFocusInfo } from './selectAllRouter';

const info = (over: Partial<SelectAllFocusInfo>): SelectAllFocusInfo => ({
  tagName: 'DIV',
  insideMonaco: false,
  ...over,
});

describe('resolveSelectAllTarget', () => {
  it('owns ⌘A for a plain <textarea> (the chat input)', () => {
    expect(resolveSelectAllTarget(info({ tagName: 'TEXTAREA' }))).toBe('native-text');
  });

  it('owns ⌘A for text-like <input> types', () => {
    for (const inputType of ['text', 'search', 'url', 'tel', 'email', 'password', 'number']) {
      expect(resolveSelectAllTarget(info({ tagName: 'INPUT', inputType }))).toBe('native-text');
    }
  });

  it('treats an <input> with no declared type as text', () => {
    expect(resolveSelectAllTarget(info({ tagName: 'INPUT', inputType: undefined }))).toBe('native-text');
  });

  it('delegates non-text <input> types (⌘A is not "select all" there)', () => {
    for (const inputType of ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit']) {
      expect(resolveSelectAllTarget(info({ tagName: 'INPUT', inputType }))).toBe('delegate');
    }
  });

  it('delegates when focus is inside Monaco — so its built-in keybinding owns ⌘A', () => {
    // The regression guard: Monaco focus lands on its own hidden <textarea>. Without the
    // insideMonaco check we would .select() that tiny composition buffer (the original bug).
    expect(resolveSelectAllTarget(info({ tagName: 'TEXTAREA', insideMonaco: true }))).toBe('delegate');
  });

  it('delegates for the workspace tree (a focusable non-text element)', () => {
    expect(resolveSelectAllTarget(info({ tagName: 'DIV' }))).toBe('delegate');
  });

  it('delegates when nothing is focused', () => {
    expect(resolveSelectAllTarget(null)).toBe('delegate');
  });
});

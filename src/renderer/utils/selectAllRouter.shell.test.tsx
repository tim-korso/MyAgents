import { afterEach, describe, expect, it } from 'vitest';

import { handleSelectAllKeydown } from './selectAllRouter';

/**
 * Imperative-shell tests (jsdom). The pure decision is covered in
 * selectAllRouter.test.ts; here we pin the two behaviours that matter at the
 * DOM boundary: (1) a focused plain text control is selected and the default
 * is prevented; (2) Monaco / tree / nothing is left completely untouched so
 * their own handlers still own ⌘A.
 */

function press(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    metaKey: true,
    cancelable: true,
    bubbles: true,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('handleSelectAllKeydown', () => {
  it('selects a focused <textarea> and prevents default (owned)', () => {
    const ta = document.createElement('textarea');
    ta.value = 'hello world';
    document.body.appendChild(ta);
    ta.focus();

    const e = press();
    const owned = handleSelectAllKeydown(e, true);

    expect(owned).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe('hello world'.length);
  });

  it('selects a focused text <input> and prevents default (owned)', () => {
    const input = document.createElement('input');
    input.value = 'filename.md';
    document.body.appendChild(input);
    input.focus();

    const e = press();
    expect(handleSelectAllKeydown(e, true)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(input.selectionEnd).toBe('filename.md'.length);
  });

  it('leaves the event UNTOUCHED when focus is inside Monaco (delegate)', () => {
    // Monaco's focused element is its hidden <textarea> under `.monaco-editor`.
    const host = document.createElement('div');
    host.className = 'monaco-editor';
    const inner = document.createElement('textarea');
    host.appendChild(inner);
    document.body.appendChild(host);
    inner.focus();

    const e = press();
    const owned = handleSelectAllKeydown(e, true);

    expect(owned).toBe(false);
    expect(e.defaultPrevented).toBe(false); // Monaco's built-in keybinding must still see it
  });

  it('leaves the event UNTOUCHED for a focused tree row (delegate)', () => {
    const row = document.createElement('div');
    row.tabIndex = 0;
    document.body.appendChild(row);
    row.focus();

    const e = press();
    expect(handleSelectAllKeydown(e, true)).toBe(false);
    expect(e.defaultPrevented).toBe(false); // tree's bubble onKeyDown must still see it
  });

  it('ignores ⌘A modifiers that are not plain select-all (Shift/Alt)', () => {
    const ta = document.createElement('textarea');
    ta.value = 'x';
    document.body.appendChild(ta);
    ta.focus();

    const shifted = new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', metaKey: true, shiftKey: true, cancelable: true,
    });
    expect(handleSelectAllKeydown(shifted, true)).toBe(false);
    expect(shifted.defaultPrevented).toBe(false);
  });
});

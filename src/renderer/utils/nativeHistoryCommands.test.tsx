import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, redo, undo } from '@codemirror/commands';
import { dispatchNativeHistoryCommand } from './nativeHistoryCommands';

let view: EditorView | undefined;
const nativeCommand = vi.fn();
beforeEach(() => { Object.defineProperty(document, 'execCommand', { value: nativeCommand, configurable: true }); nativeCommand.mockReset(); });
afterEach(() => { view?.destroy(); view = undefined; document.body.replaceChildren(); });

describe('native history command ownership', () => {
  it('delegates native menu intent to editor history even without native undo records', () => {
    view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'hello', extensions: [history(), keymap.of([
      { key: 'Meta-z', run: undo, preventDefault: true },
      { key: 'Meta-Shift-z', run: redo, preventDefault: true },
    ])] }) });
    view.focus();
    view.dispatch({ changes: { from: 0, to: 5, insert: '`hello`' }, userEvent: 'input.format' });
    dispatchNativeHistoryCommand('undo');
    expect(view.state.doc.toString()).toBe('hello');
    dispatchNativeHistoryCommand('redo');
    expect(view.state.doc.toString()).toBe('`hello`');
    dispatchNativeHistoryCommand('redo'); // Empty editor history must not fall through.
    expect(nativeCommand).not.toHaveBeenCalled();
  });

  it('keeps unhandled ordinary text controls on native history', () => {
    const input = document.createElement('textarea'); document.body.append(input); input.focus();
    dispatchNativeHistoryCommand('undo');
    expect(nativeCommand).toHaveBeenCalledExactlyOnceWith('undo');
    input.readOnly = true;
    dispatchNativeHistoryCommand('redo');
    expect(nativeCommand).toHaveBeenCalledTimes(1);
  });

  it('does not undo another field from body, inert content, or a non-text input', () => {
    dispatchNativeHistoryCommand('undo');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; document.body.append(checkbox); checkbox.focus();
    dispatchNativeHistoryCommand('undo');
    const area = document.createElement('textarea'); area.setAttribute('inert', ''); document.body.append(area); area.focus();
    dispatchNativeHistoryCommand('undo');
    expect(nativeCommand).not.toHaveBeenCalled();
  });
});

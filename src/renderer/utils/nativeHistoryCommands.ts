import { resolveSelectAllTarget } from './selectAllRouter';

export type NativeHistoryCommand = 'undo' | 'redo';

/** Native macOS menu shortcuts never reach DOM keydown. Delegate to the
 * focused editor's existing keymap, whose history can differ from WebKit's.
 * Plain text controls keep WebKit history; never undo an unfocused editor. */
export function dispatchNativeHistoryCommand(command: NativeHistoryCommand): void {
  if ((command !== 'undo' && command !== 'redo') || !document.hasFocus()) return;
  const target = document.activeElement;
  if (!(target instanceof HTMLElement) || target.closest('[inert]')) return;
  // Monaco's installed keyboard adapter still reads keyCode.
  const event = new KeyboardEvent('keydown', {
    key: 'z', code: 'KeyZ', keyCode: 90, metaKey: true, shiftKey: command === 'redo', bubbles: true, cancelable: true,
  });
  target.dispatchEvent(event);
  if (event.defaultPrevented) return;

  const nativeText = resolveSelectAllTarget({ tagName: target.tagName,
    inputType: target instanceof HTMLInputElement ? target.type : undefined,
    insideMonaco: !!target.closest('.monaco-editor') }) === 'native-text';
  if (nativeText && !(target as HTMLInputElement | HTMLTextAreaElement).readOnly && !(target as HTMLInputElement | HTMLTextAreaElement).disabled) {
    document.execCommand(command);
  }
}

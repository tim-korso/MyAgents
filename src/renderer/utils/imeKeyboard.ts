/**
 * IME owns candidate selection/commit keys before application shortcuts do.
 * WebKit can end composition before dispatching the confirming Enter, leaving
 * isComposing false but keyCode 229. Check both for React and native listeners.
 * Callers should return without preventing the native text-input behavior.
 */
export function isImeComposingEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return Boolean(event.isComposing || event.nativeEvent?.isComposing)
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229;
}

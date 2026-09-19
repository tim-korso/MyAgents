import { describe, expect, it } from 'vitest';
import { isImeComposingEvent } from './imeKeyboard';

describe('IME keyboard ownership', () => {
  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
    { nativeEvent: { isComposing: true }, keyCode: 13 },
    { nativeEvent: { isComposing: false, keyCode: 229 } },
    { nativeEvent: { isComposing: false }, keyCode: 229 },
  ])('recognizes composition before or after the WebKit composition-end event: %j', event => {
    expect(isImeComposingEvent(event)).toBe(true);
  });
  it.each([{}, { isComposing: false, keyCode: 13 }, { nativeEvent: { isComposing: false }, keyCode: 13 }])('allows the next deliberate key: %j', event => {
    expect(isImeComposingEvent(event)).toBe(false);
  });
});

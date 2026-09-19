import { describe, expect, it } from 'vitest';

import { resolveChatBottomSpacerPx } from './chatBottomSpacer';

describe('resolveChatBottomSpacerPx', () => {
  it('uses a compact fallback when no overlay measurement is available', () => {
    expect(resolveChatBottomSpacerPx(null)).toBe(216);
  });

  it('tracks the measured floating input stack instead of a fixed half-screen spacer', () => {
    expect(resolveChatBottomSpacerPx(152.2)).toBe(193);
  });

  it('clamps expanded overlay panels to a bounded spacer', () => {
    expect(resolveChatBottomSpacerPx(800)).toBe(420);
  });
});

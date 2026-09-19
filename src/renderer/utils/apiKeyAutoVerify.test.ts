import { describe, expect, it } from 'vitest';

import { shouldDebounceAutoVerify } from './apiKeyAutoVerify';

describe('shouldDebounceAutoVerify', () => {
  it('empty new key never verifies', () => {
    expect(shouldDebounceAutoVerify('abcdef', '')).toBe(false);
    expect(shouldDebounceAutoVerify('', '')).toBe(false);
  });

  describe('issue #306: backspacing an expired key', () => {
    it('skips verify on every backspace as length shrinks', () => {
      const original = 'sk-expired-xxxxx';
      let cur = original;
      const decisions: boolean[] = [];
      while (cur.length > 0) {
        const next = cur.slice(0, -1);
        decisions.push(shouldDebounceAutoVerify(cur, next));
        cur = next;
      }
      // Every single backspace must be a "skip" so no verify cycle fires.
      expect(decisions.every(d => d === false)).toBe(true);
    });
  });

  describe('growing the key (paste / typing forward)', () => {
    it('paste from empty triggers verify', () => {
      expect(shouldDebounceAutoVerify('', 'sk-new-key-pasted-in')).toBe(true);
    });
    it('character append triggers verify', () => {
      expect(shouldDebounceAutoVerify('sk-1234', 'sk-12345')).toBe(true);
    });
  });

  describe('equal-length replacement (select-all + paste)', () => {
    it('still triggers verify — user explicitly replaced the key', () => {
      expect(shouldDebounceAutoVerify('aaaaaaaa', 'bbbbbbbb')).toBe(true);
    });
  });

  describe('shorter replacement (review): select-all + paste of a shorter valid key', () => {
    it('triggers verify — shorter but content differs (not a tail deletion)', () => {
      // The old "any length decrease = deletion" rule wrongly suppressed this.
      expect(shouldDebounceAutoVerify('sk-old-longer-key-aaaa', 'sk-new-short')).toBe(true);
    });
    it('mid-string edit shrinking the key still verifies (not a prefix of old)', () => {
      expect(shouldDebounceAutoVerify('abcdefgh', 'abXYef')).toBe(true);
    });
    it('still skips a genuine tail trim (prefix of old, shorter)', () => {
      expect(shouldDebounceAutoVerify('sk-12345', 'sk-123')).toBe(false);
    });
  });
});

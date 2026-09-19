import { describe, expect, it } from 'vitest';

import { isPerfEnabled } from './perfMark';

describe('isPerfEnabled — perf-mark gating', () => {
    it('is enabled in a dev/debug build (DEV or VITE_DEBUG_MODE) regardless of localStorage', () => {
        expect(isPerfEnabled(true, () => null)).toBe(true);
        expect(isPerfEnabled(true, () => '0')).toBe(true);
    });

    it('is enabled in a prod build only when the localStorage flag is exactly "1"', () => {
        expect(isPerfEnabled(false, () => '1')).toBe(true);
    });

    it('is disabled in a prod build without the flag', () => {
        expect(isPerfEnabled(false, () => null)).toBe(false);
        expect(isPerfEnabled(false, () => '0')).toBe(false);
        expect(isPerfEnabled(false, () => 'true')).toBe(false);
    });

    it('is disabled and never throws when localStorage access throws', () => {
        expect(isPerfEnabled(false, () => { throw new Error('blocked'); })).toBe(false);
    });
});

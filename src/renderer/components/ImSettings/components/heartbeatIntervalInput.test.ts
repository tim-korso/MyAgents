import { describe, expect, it } from 'vitest';

import {
    HEARTBEAT_INTERVAL_MAX,
    HEARTBEAT_INTERVAL_MIN,
    commitHeartbeatIntervalDraft,
    isHeartbeatIntervalCustom,
    resolveHeartbeatIntervalInputValue,
} from './heartbeatIntervalInput';

const PRESETS = [5, 15, 30, 60, 240] as const;

describe('resolveHeartbeatIntervalInputValue (#310 regression)', () => {
    it('shows the draft verbatim while editing, even when a single digit is below the persisted min', () => {
        // #310 case 1: "10" — first keystroke "1" used to be dropped (1 < 5),
        // input snapped back to "", user couldn't reach 10.
        expect(resolveHeartbeatIntervalInputValue('1', 30, PRESETS)).toBe('1');
    });

    it('shows the draft verbatim while editing, even when it equals a preset', () => {
        // #310 case 2: "50" — first keystroke "5" matched the 5-minute preset,
        // derived "isCustom" flipped off, input cleared, preset chip lit up.
        expect(resolveHeartbeatIntervalInputValue('5', 30, PRESETS)).toBe('5');
        expect(resolveHeartbeatIntervalInputValue('15', 30, PRESETS)).toBe('15');
    });

    it('shows the empty draft (not the committed fallback) when the user has cleared the box', () => {
        expect(resolveHeartbeatIntervalInputValue('', 45, PRESETS)).toBe('');
    });

    it('idle (draft null) shows empty when committed minutes match a preset', () => {
        expect(resolveHeartbeatIntervalInputValue(null, 30, PRESETS)).toBe('');
        expect(resolveHeartbeatIntervalInputValue(null, 60, PRESETS)).toBe('');
    });

    it('idle (draft null) shows the committed value for custom (non-preset) minutes', () => {
        expect(resolveHeartbeatIntervalInputValue(null, 45, PRESETS)).toBe('45');
        expect(resolveHeartbeatIntervalInputValue(null, 7, PRESETS)).toBe('7');
    });
});

describe('commitHeartbeatIntervalDraft', () => {
    it('reverts on empty or whitespace draft', () => {
        expect(commitHeartbeatIntervalDraft('')).toEqual({ kind: 'revert' });
        expect(commitHeartbeatIntervalDraft('   ')).toEqual({ kind: 'revert' });
    });

    it('reverts on non-numeric draft', () => {
        expect(commitHeartbeatIntervalDraft('abc')).toEqual({ kind: 'revert' });
    });

    it('commits a valid in-range numeric draft', () => {
        expect(commitHeartbeatIntervalDraft('45')).toEqual({ kind: 'commit', value: 45 });
        expect(commitHeartbeatIntervalDraft('10')).toEqual({ kind: 'commit', value: 10 });
    });

    it('clamps values below min up to min (eg. blur on "1" or "0" snaps to 5)', () => {
        expect(commitHeartbeatIntervalDraft('1')).toEqual({
            kind: 'commit',
            value: HEARTBEAT_INTERVAL_MIN,
        });
        expect(commitHeartbeatIntervalDraft('0')).toEqual({
            kind: 'commit',
            value: HEARTBEAT_INTERVAL_MIN,
        });
    });

    it('clamps values above max down to max', () => {
        expect(commitHeartbeatIntervalDraft('9999')).toEqual({
            kind: 'commit',
            value: HEARTBEAT_INTERVAL_MAX,
        });
    });

    it('uses parseInt semantics for decimals / trailing garbage', () => {
        expect(commitHeartbeatIntervalDraft('45.7')).toEqual({ kind: 'commit', value: 45 });
        expect(commitHeartbeatIntervalDraft('45abc')).toEqual({ kind: 'commit', value: 45 });
    });

    it('reads scientific notation as the large number it is and clamps to max (not parseInt-truncated to 1)', () => {
        // <input type="number"> accepts "1e9"; parseInt('1e9',10)===1 would have
        // clamped UP to min(5). Number('1e9')===1e9 → clamps DOWN to max(1440).
        expect(commitHeartbeatIntervalDraft('1e9')).toEqual({
            kind: 'commit',
            value: HEARTBEAT_INTERVAL_MAX,
        });
        // In-range exponent commits the resolved value (1.5e1 = 15).
        expect(commitHeartbeatIntervalDraft('1.5e1')).toEqual({ kind: 'commit', value: 15 });
    });

    it('honors custom min/max override', () => {
        expect(commitHeartbeatIntervalDraft('3', { min: 1, max: 10 })).toEqual({
            kind: 'commit',
            value: 3,
        });
        expect(commitHeartbeatIntervalDraft('100', { min: 1, max: 10 })).toEqual({
            kind: 'commit',
            value: 10,
        });
    });
});

describe('isHeartbeatIntervalCustom', () => {
    it('returns false for every preset value', () => {
        for (const v of PRESETS) {
            expect(isHeartbeatIntervalCustom(v, PRESETS)).toBe(false);
        }
    });

    it('returns true for non-preset values', () => {
        expect(isHeartbeatIntervalCustom(10, PRESETS)).toBe(true);
        expect(isHeartbeatIntervalCustom(45, PRESETS)).toBe(true);
        expect(isHeartbeatIntervalCustom(1440, PRESETS)).toBe(true);
    });
});

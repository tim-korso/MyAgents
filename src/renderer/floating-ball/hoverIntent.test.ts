import { describe, expect, it } from 'vitest';

import {
    createFloatingBallHoverIntentState,
    enterFloatingBallHover,
    leaveFloatingBallHover,
    suppressHoverPeekUntilBallLeave,
} from './hoverIntent';

const ENABLED_GUARDS = {
    hoverEnabled: true,
    dragging: false,
    companionPinned: false,
};

describe('floating-ball hover intent', () => {
    it('starts peek only once for duplicate native and DOM enter signals', () => {
        const state = createFloatingBallHoverIntentState();

        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(true);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(false);
        expect(leaveFloatingBallHover(state)).toBe(true);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(true);
    });

    it('suppresses hover reopen after closing pin from the ball until a real leave', () => {
        const state = createFloatingBallHoverIntentState();

        suppressHoverPeekUntilBallLeave(state);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(false);
        expect(leaveFloatingBallHover(state)).toBe(true);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(true);
    });

    it('keeps hover suppressed across duplicate enter edges until leave confirms outside', () => {
        const state = createFloatingBallHoverIntentState();

        suppressHoverPeekUntilBallLeave(state);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(false);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(false);
        expect(leaveFloatingBallHover(state)).toBe(true);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(true);
    });

    it('does not peek while the companion is already pinned', () => {
        const state = createFloatingBallHoverIntentState();

        expect(enterFloatingBallHover(state, { ...ENABLED_GUARDS, companionPinned: true })).toBe(false);
        expect(leaveFloatingBallHover(state)).toBe(true);
        expect(enterFloatingBallHover(state, ENABLED_GUARDS)).toBe(true);
    });
});

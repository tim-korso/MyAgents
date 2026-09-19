import { describe, expect, it } from 'vitest';

import {
    getTabPointerDragDecision,
    isPrimaryPointerButtonPressed,
    TAB_POINTER_SENSOR_OPTIONS,
} from './tabPointerSensor';

describe('tabPointerSensor', () => {
    it('keeps common trackpad tap drift pending instead of starting a tab drag', () => {
        expect(getTabPointerDragDecision({ x: 8, y: 0 })).toBe('pending');
        expect(getTabPointerDragDecision({ x: 10, y: 6 })).toBe('pending');
        expect(getTabPointerDragDecision({ x: 15, y: 2 })).toBe('pending');
    });

    it('starts only on clear horizontal reorder intent', () => {
        expect(getTabPointerDragDecision({ x: TAB_POINTER_SENSOR_OPTIONS.minHorizontalDistance, y: 0 }))
            .toBe('start');
        expect(getTabPointerDragDecision({ x: -24, y: 8 })).toBe('start');
    });

    it('cancels pending drags that turn into vertical movement', () => {
        expect(getTabPointerDragDecision({ x: 4, y: 20 })).toBe('cancel');
        expect(getTabPointerDragDecision({ x: 18, y: 22 })).toBe('cancel');
    });

    it('treats a zero-buttons pointermove as released', () => {
        expect(isPrimaryPointerButtonPressed(0)).toBe(false);
        expect(isPrimaryPointerButtonPressed(1)).toBe(true);
        expect(isPrimaryPointerButtonPressed(3)).toBe(true);
    });
});

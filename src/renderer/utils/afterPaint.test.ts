// Unit test for runAfterNextPaint — the post-paint scheduler that replaced the
// starvable low-priority transition used to reveal a freshly-created tab's heavy
// content (see App.openNewTabDeferred / afterPaint.ts).
//
// NOTE: the original bug (the "新建 tab 黄屏" 1-2s blank) is a React scheduler
// PRIORITY behavior — a useTransition reveal being starved by background-tab
// SSE/poll updates — which cannot be reproduced deterministically in jsdom.
// What IS testable, and what this guards, is the replacement primitive's
// contract: it must defer to the SECOND animation frame (so the placeholder
// paints first), never fire synchronously, and honor cancellation.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAfterNextPaint } from './afterPaint';

describe('runAfterNextPaint', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not invoke the callback synchronously', () => {
        // Two-deep rAF that never auto-flushes — proves nothing fires inline.
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const cb = vi.fn();
        runAfterNextPaint(cb);
        expect(cb).not.toHaveBeenCalled();
    });

    it('fires the callback only after the SECOND animation frame', () => {
        // Capture each rAF callback so we can flush frames one at a time.
        const frames: Array<() => void> = [];
        let next = 1;
        vi.stubGlobal('requestAnimationFrame', vi.fn((fn: () => void) => {
            frames.push(fn);
            return next++;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const cb = vi.fn();
        runAfterNextPaint(cb);

        // Frame 1 (placeholder paint): callback must NOT have fired yet.
        expect(frames).toHaveLength(1);
        frames[0]();
        expect(cb).not.toHaveBeenCalled();

        // Frame 2 (next paint): now it fires exactly once.
        expect(frames).toHaveLength(2);
        frames[1]();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('cancel() before the first frame prevents the callback', () => {
        const frames: Array<() => void> = [];
        let next = 1;
        const cancelSpy = vi.fn();
        vi.stubGlobal('requestAnimationFrame', vi.fn((fn: () => void) => {
            frames.push(fn);
            return next++;
        }));
        vi.stubGlobal('cancelAnimationFrame', cancelSpy);

        const cb = vi.fn();
        const cancel = runAfterNextPaint(cb);
        cancel();
        // Even if the scheduler somehow runs the queued frames, cb stays silent.
        frames.forEach(fn => fn());
        expect(cb).not.toHaveBeenCalled();
        expect(cancelSpy).toHaveBeenCalled();
    });

    it('cancel() between the two frames prevents the callback', () => {
        const frames: Array<() => void> = [];
        let next = 1;
        vi.stubGlobal('requestAnimationFrame', vi.fn((fn: () => void) => {
            frames.push(fn);
            return next++;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const cb = vi.fn();
        const cancel = runAfterNextPaint(cb);
        frames[0](); // schedules the inner frame
        cancel();
        frames[1]?.(); // inner frame fires but must be a no-op
        expect(cb).not.toHaveBeenCalled();
    });

    it('falls back to setTimeout when requestAnimationFrame is unavailable', () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        vi.useFakeTimers();
        const cb = vi.fn();
        runAfterNextPaint(cb);
        expect(cb).not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(cb).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});

import { describe, expect, it, vi } from 'vitest';

import { createFocusConvergence } from './focusConvergence';

function createFrameQueue() {
    const queue: FrameRequestCallback[] = [];
    return {
        queue,
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
            queue.push(callback);
            return queue.length;
        }),
        cancelAnimationFrame: vi.fn(),
        flushOne() {
            const callback = queue.shift();
            if (callback) callback(0);
        },
    };
}

describe('createFocusConvergence', () => {
    it('retries focus until the target actually owns focus', () => {
        const frames = createFrameQueue();
        let focusCalls = 0;
        let focused = false;
        const target = {
            focus: vi.fn(() => {
                focusCalls += 1;
                focused = focusCalls >= 3;
            }),
        } as unknown as HTMLElement;
        const controller = createFocusConvergence({
            getTarget: () => target,
            shouldContinue: () => true,
            isFocused: () => focused,
            maxAttempts: 5,
            requestAnimationFrame: frames.requestAnimationFrame,
            cancelAnimationFrame: frames.cancelAnimationFrame,
        });

        controller.request();
        frames.flushOne();
        frames.flushOne();
        frames.flushOne();

        expect(target.focus).toHaveBeenCalledTimes(3);
        expect(frames.queue).toHaveLength(0);
    });

    it('stops at the bounded attempt limit', () => {
        const frames = createFrameQueue();
        const target = { focus: vi.fn() } as unknown as HTMLElement;
        const controller = createFocusConvergence({
            getTarget: () => target,
            shouldContinue: () => true,
            isFocused: () => false,
            maxAttempts: 2,
            requestAnimationFrame: frames.requestAnimationFrame,
            cancelAnimationFrame: frames.cancelAnimationFrame,
        });

        controller.request();
        frames.flushOne();
        frames.flushOne();

        expect(target.focus).toHaveBeenCalledTimes(2);
        expect(frames.queue).toHaveLength(0);
    });

    it('can require several focus passes even when DOM already reports focused', () => {
        const frames = createFrameQueue();
        const target = { focus: vi.fn() } as unknown as HTMLElement;
        const controller = createFocusConvergence({
            getTarget: () => target,
            shouldContinue: () => true,
            isFocused: () => true,
            maxAttempts: 8,
            minAttempts: 3,
            requestAnimationFrame: frames.requestAnimationFrame,
            cancelAnimationFrame: frames.cancelAnimationFrame,
        });

        controller.request();
        frames.flushOne();
        frames.flushOne();
        frames.flushOne();

        expect(target.focus).toHaveBeenCalledTimes(3);
        expect(frames.queue).toHaveLength(0);
    });

    it('cancels a pending convergence request', () => {
        const frames = createFrameQueue();
        const target = { focus: vi.fn() } as unknown as HTMLElement;
        const controller = createFocusConvergence({
            getTarget: () => target,
            shouldContinue: () => true,
            isFocused: () => false,
            requestAnimationFrame: frames.requestAnimationFrame,
            cancelAnimationFrame: frames.cancelAnimationFrame,
        });

        controller.request();
        controller.cancel();
        frames.flushOne();

        expect(target.focus).not.toHaveBeenCalled();
        expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    });
});

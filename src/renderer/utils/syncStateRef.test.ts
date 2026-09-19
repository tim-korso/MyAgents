import { describe, expect, it, vi } from 'vitest';

import { createSyncStateRef } from './syncStateRef';

describe('createSyncStateRef', () => {
    it('exposes the initial value via current', () => {
        const notify = vi.fn();
        const ref = createSyncStateRef({ count: 0 }, notify);
        expect(ref.current).toEqual({ count: 0 });
        expect(notify).not.toHaveBeenCalled();
    });

    it('updates current synchronously when set is called with a literal', () => {
        const notify = vi.fn();
        const ref = createSyncStateRef<{ count: number }>({ count: 0 }, notify);
        ref.set({ count: 1 });
        // The whole point of this helper: current is the new value the
        // very next instruction. No microtask, no render commit needed.
        expect(ref.current).toEqual({ count: 1 });
        expect(notify).toHaveBeenCalledExactlyOnceWith({ count: 1 });
    });

    it('updates current synchronously when set is called with a functional updater', () => {
        const notify = vi.fn();
        const ref = createSyncStateRef<{ count: number }>({ count: 5 }, notify);
        ref.set((prev) => ({ count: prev.count + 1 }));
        expect(ref.current).toEqual({ count: 6 });
        expect(notify).toHaveBeenCalledExactlyOnceWith({ count: 6 });
    });

    it('composes multiple back-to-back set calls in the same tick (regression: launcher cron race)', () => {
        // This is the exact bug class the wrapper exists to prevent.
        // In the old code, enableCronMode called setState({...}), startTask
        // read stateRef.current immediately after — and got the *old*
        // value because React hadn't committed yet. With createSyncStateRef
        // sync semantics, the second instruction sees the first's write
        // without waiting for any React lifecycle.
        const notify = vi.fn();
        type S = { config: string | null; counter: number };
        const ref = createSyncStateRef<S>({ config: null, counter: 0 }, notify);

        // First mutation — equivalent to enableCronMode setting config.
        ref.set({ config: 'cron-config-x', counter: 0 });
        // Same-tick read — equivalent to startTask reading stateRef.current.config.
        // Without sync semantics, this would still be null and trigger the
        // silent early-return bug.
        expect(ref.current.config).toBe('cron-config-x');

        // A second functional mutation must compose correctly.
        ref.set((prev) => ({ ...prev, counter: prev.counter + 1 }));
        expect(ref.current.counter).toBe(1);
        expect(ref.current.config).toBe('cron-config-x');

        // Notify fires once per set, with the post-update value each time —
        // matches React setState's contract for a downstream setStateRaw.
        expect(notify).toHaveBeenCalledTimes(2);
        expect(notify).toHaveBeenNthCalledWith(1, { config: 'cron-config-x', counter: 0 });
        expect(notify).toHaveBeenNthCalledWith(2, { config: 'cron-config-x', counter: 1 });
    });

    it('functional updaters read the latest current, not the original initial', () => {
        // Guards against the trap where prev-snapshot is captured at scheduling
        // time. Here we simulate React's lazy-callback semantics that the old
        // wrapper relied on: if `prev` were the initial value (0), the second
        // updater would compute 1 not 2.
        const notify = vi.fn();
        const ref = createSyncStateRef<number>(0, notify);
        ref.set((prev) => prev + 1);
        ref.set((prev) => prev + 1);
        expect(ref.current).toBe(2);
    });

    it('notify receives exactly the value that current resolves to', () => {
        // Invariant for the React adapter: setStateRaw(value) must apply
        // the same value the rest of the hook now believes is current.
        // If this drifts, React renders one state and ref-readers see another.
        const observed: number[] = [];
        const ref = createSyncStateRef<number>(0, (v) => observed.push(v));
        ref.set(10);
        ref.set((prev) => prev * 2);
        ref.set(99);
        expect(observed).toEqual([10, 20, 99]);
        expect(ref.current).toBe(99);
    });
});

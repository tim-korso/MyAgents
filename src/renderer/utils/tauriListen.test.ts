import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listenWithCleanup } from './tauriListen';

// Stub `@tauri-apps/api/event` — vi.mock auto-hoists. The mock impl gives
// us a controllable `listen()` that returns an unlisten spy and lets the
// test simulate event emission via the stored handler reference.
type Handler = (event: { payload: unknown }) => void;
const mockListen = vi.fn();
const mockUnlistenSpies: Array<ReturnType<typeof vi.fn>> = [];
const mockHandlers: Map<string, Handler> = new Map();

vi.mock('@tauri-apps/api/event', () => ({
    listen: (...args: unknown[]) => mockListen(...args),
}));

const setupMockListen = (delayMs = 0): void => {
    mockListen.mockImplementation((event: string, handler: Handler) => {
        mockHandlers.set(event, handler);
        const unlisten = vi.fn();
        mockUnlistenSpies.push(unlisten);
        if (delayMs === 0) return Promise.resolve(unlisten);
        return new Promise<typeof unlisten>((resolve) => {
            setTimeout(() => resolve(unlisten), delayMs);
        });
    });
};

const fireEvent = (event: string, payload: unknown): void => {
    const handler = mockHandlers.get(event);
    if (handler) handler({ payload });
};

beforeEach(() => {
    mockListen.mockReset();
    mockUnlistenSpies.length = 0;
    mockHandlers.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('listenWithCleanup', () => {
    it('preserves a Webview target through registration and abort cleanup', async () => {
        setupMockListen();
        const ac = new AbortController();
        const handler = vi.fn();
        const options = { target: { kind: 'Webview' as const, label: 'main' } };
        const result = await listenWithCleanup('window:history-command', handler, ac.signal, options);
        expect(mockListen).toHaveBeenCalledExactlyOnceWith('window:history-command', expect.any(Function), options);
        fireEvent('window:history-command', 'undo');
        expect(handler).toHaveBeenCalledExactlyOnceWith({ payload: 'undo' });
        ac.abort();
        fireEvent('window:history-command', 'redo');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(mockUnlistenSpies[0]).toHaveBeenCalledTimes(1);
        expect(result.isRegistered()).toBe(false);
    });

    describe('happy path', () => {
        it('registers a listener and forwards events to the handler', async () => {
            setupMockListen();
            const ac = new AbortController();
            const handler = vi.fn();

            const result = await listenWithCleanup<string>('test:event', handler, ac.signal);

            expect(result.isRegistered()).toBe(true);
            expect(mockListen).toHaveBeenCalledExactlyOnceWith('test:event', expect.any(Function), undefined);

            fireEvent('test:event', 'hello');
            expect(handler).toHaveBeenCalledExactlyOnceWith({ payload: 'hello' });
        });

        it('cleans up automatically when the signal is aborted', async () => {
            setupMockListen();
            const ac = new AbortController();
            const handler = vi.fn();

            await listenWithCleanup<string>('test:event', handler, ac.signal);
            expect(mockUnlistenSpies[0]).not.toHaveBeenCalled();

            ac.abort();
            expect(mockUnlistenSpies[0]).toHaveBeenCalledTimes(1);

            // Subsequent emits land on a no-op (handler is also gated by signal)
            fireEvent('test:event', 'late');
            expect(handler).not.toHaveBeenCalled();
        });

        it('drops events that arrive after abort even if Tauri unlisten lags', async () => {
            // Even before unlisten() actually runs (e.g. it's queued), the
            // wrapper's signal-check inside the handler must drop the event.
            // Without this guard, queued-but-not-yet-flushed events would
            // still hit the user's handler.
            setupMockListen();
            const ac = new AbortController();
            const handler = vi.fn();

            await listenWithCleanup<string>('test:event', handler, ac.signal);

            // Simulate an event arriving simultaneously with abort: abort first
            // (synchronously in JS), then dispatch from the same tick.
            ac.abort();
            fireEvent('test:event', 'late');

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('race conditions (the bug class this exists for)', () => {
        it('skips listen() entirely if signal aborts before listen() is called (sync abort)', async () => {
            setupMockListen();
            const ac = new AbortController();
            ac.abort(); // already aborted before we register

            const handler = vi.fn();
            const result = await listenWithCleanup<string>('test:event', handler, ac.signal);

            expect(mockListen).not.toHaveBeenCalled();
            expect(result.isRegistered()).toBe(false);
        });

        it('immediately unlistens when abort fires DURING the listen() await (the original leak)', async () => {
            // This is the exact race that bare `await listen()` callsites
            // leak on. We use a manually-controlled deferred promise for
            // listen()'s resolution so we can: (a) start the helper, (b)
            // abort while the await is still pending, (c) resolve listen()
            // *after* the abort, then (d) verify the helper unlistens
            // immediately. Real timers + manual deferral, no fake timers
            // (dynamic `import()` and microtasks don't play nicely with fake
            // timers in vitest).
            let resolveListen: (unlisten: ReturnType<typeof vi.fn>) => void = () => undefined;
            const listenPromise = new Promise<ReturnType<typeof vi.fn>>((res) => {
                resolveListen = res;
            });
            const unlistenSpy = vi.fn();
            mockUnlistenSpies.push(unlistenSpy);
            mockListen.mockImplementation((event: string, handler: Handler) => {
                mockHandlers.set(event, handler);
                return listenPromise;
            });

            const ac = new AbortController();
            const handler = vi.fn();
            const helperPromise = listenWithCleanup<string>('test:event', handler, ac.signal);

            // Park: keep yielding microtasks until the helper has reached
            // `await listen(...)`. The helper's pre-await sync work (signal
            // check, function setup) takes an indeterminate number of
            // microtasks before reaching the listen() await; polling for
            // `mockListen` being called is the most robust signal that the
            // helper is now parked on the listen() await.
            for (let i = 0; i < 20 && mockListen.mock.calls.length === 0; i++) {
                await Promise.resolve();
            }
            expect(mockListen).toHaveBeenCalledTimes(1);

            // Abort while the helper is parked on `await listen(...)`.
            ac.abort();

            // NOW resolve the listen() promise. Helper sees post-await abort.
            resolveListen(unlistenSpy);
            const result = await helperPromise;

            expect(mockListen).toHaveBeenCalledTimes(1);
            expect(unlistenSpy).toHaveBeenCalledTimes(1);
            expect(result.isRegistered()).toBe(false);

            // Late events after the post-await teardown must not hit the handler
            fireEvent('test:event', 'late');
            expect(handler).not.toHaveBeenCalled();
        });

        it('handles back-to-back abort+register on a fresh AbortController correctly', async () => {
            // Simulates StrictMode double-mount: register, abort, register again
            // with a fresh controller. The second registration must work.
            setupMockListen();
            const ac1 = new AbortController();
            const ac2 = new AbortController();
            const handler = vi.fn();

            await listenWithCleanup<string>('test:event', handler, ac1.signal);
            ac1.abort();
            await listenWithCleanup<string>('test:event', handler, ac2.signal);

            expect(mockListen).toHaveBeenCalledTimes(2);
            // First listener unlistened on abort
            expect(mockUnlistenSpies[0]).toHaveBeenCalledTimes(1);
            // Second listener still registered
            expect(mockUnlistenSpies[1]).not.toHaveBeenCalled();
        });
    });

    describe('multi-listener composition', () => {
        it('shares a single AbortController across multiple listeners', async () => {
            setupMockListen();
            const ac = new AbortController();
            const handlerA = vi.fn();
            const handlerB = vi.fn();
            const handlerC = vi.fn();

            await listenWithCleanup('event:a', handlerA, ac.signal);
            await listenWithCleanup('event:b', handlerB, ac.signal);
            await listenWithCleanup('event:c', handlerC, ac.signal);

            expect(mockUnlistenSpies).toHaveLength(3);
            expect(mockUnlistenSpies.every((s) => !s.mock.calls.length)).toBe(true);

            ac.abort();

            // All three teardown together
            expect(mockUnlistenSpies.every((s) => s.mock.calls.length === 1)).toBe(true);
        });
    });

    describe('error handling', () => {
        it('logs and swallows registration errors so void-call sites do not produce unhandled rejections', async () => {
            // Most call sites invoke via `void listenWithCleanup(...)` without
            // attaching a catch handler — a rejection there would become an
            // unhandled promise rejection. The helper logs + swallows to
            // avoid that noise; the underlying Tauri IPC failure is not
            // recoverable from a per-listener catch anyway.
            mockListen.mockImplementation(() => Promise.reject(new Error('IPC dropped')));
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const ac = new AbortController();

            const result = await listenWithCleanup<string>('test:event', vi.fn(), ac.signal);

            expect(result.isRegistered()).toBe(false);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toContain('test:event');
            warnSpy.mockRestore();
        });

        it('does not log when the registration error coincides with an already-aborted signal', async () => {
            // Caller aborted before registration completed — the failure is
            // expected (we'd have torn down anyway). No warn noise.
            mockListen.mockImplementation(() => Promise.reject(new Error('late ipc fail')));
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const ac = new AbortController();
            ac.abort();

            const result = await listenWithCleanup<string>('test:event', vi.fn(), ac.signal);
            expect(result.isRegistered()).toBe(false);
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('manual unlisten', () => {
        it('manual unlisten teardown is idempotent', async () => {
            setupMockListen();
            const ac = new AbortController();
            const result = await listenWithCleanup<string>('test:event', vi.fn(), ac.signal);

            result.unlisten();
            result.unlisten(); // second call must not double-fire
            expect(mockUnlistenSpies[0]).toHaveBeenCalledTimes(1);
            expect(result.isRegistered()).toBe(false);
        });

        it('abort after manual unlisten does not double-fire', async () => {
            setupMockListen();
            const ac = new AbortController();
            const result = await listenWithCleanup<string>('test:event', vi.fn(), ac.signal);

            result.unlisten();
            ac.abort();

            expect(mockUnlistenSpies[0]).toHaveBeenCalledTimes(1);
        });

        it('drops events queued after manual unlisten even when signal is never aborted (Codex review WARN-1)', async () => {
            // The handler's signal.aborted check would NOT block a queued
            // event in the manual-unlisten path because the signal stays
            // un-aborted. The internal `disposed` flag covers it.
            setupMockListen();
            const ac = new AbortController();
            const handler = vi.fn();
            const result = await listenWithCleanup<string>('test:event', handler, ac.signal);

            result.unlisten();
            // Tauri's internal channel hasn't fully torn down — simulate a
            // queued dispatch that arrives after unlisten() but before the
            // dispatcher's slot is reclaimed.
            fireEvent('test:event', 'after-manual-unlisten');

            expect(handler).not.toHaveBeenCalled();
        });
    });
});

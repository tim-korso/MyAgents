/**
 * `createSyncStateRef` — a state container that exposes a `current` value
 * synchronously after every mutation, then notifies a downstream React
 * setState. The point is to make "read latest after just-wrote" safe within
 * the same JavaScript turn, even if React hasn't committed the update yet.
 *
 * **Why this isn't a stock pattern**: useState + useRef is the obvious
 * combo, but the sequence
 *
 *     setState(next);            // schedules update, doesn't apply now
 *     stateRef.current === ?;    // still the OLD value
 *
 * causes a class of "ghost" bugs where a function and its caller think
 * they share state but each sees a different snapshot. This was the root
 * cause of the launcher cron handoff silently failing
 * (enableCronMode → setState scheduled → startTask reads null config →
 * silent early-return). Centralising the ref write inside `set()` removes
 * the possibility of forgetting to sync it, which had drifted across the
 * `useCronTask` codebase (some setState calls synced the ref, some
 * didn't — easy to miss in review).
 *
 * The container itself is pure (no React dependency) so the contract can
 * be unit-tested without renderHook. The hook wires it up via
 * `setReact = useState(...)[1]; createSyncStateRef(initial, setReact)`.
 */
export interface SyncStateRef<T> {
    /** The latest value — synchronously updated by `set`. */
    readonly current: T;
    /**
     * Mutate. Accepts either a literal next value or a `(prev) => next`
     * functional updater. `prev` is read from `current` (not from a stale
     * React snapshot), so consecutive `set` calls in the same tick compose
     * correctly without depending on React's batching semantics.
     */
    set: (updater: T | ((prev: T) => T)) => void;
}

export function createSyncStateRef<T>(
    initial: T,
    notify: (next: T) => void,
): SyncStateRef<T> {
    // `box` holds the canonical "latest" value. We keep it inside a closure
    // (rather than a plain `let`) so the returned object's `current` getter
    // can read through it without copying.
    const box = { value: initial };
    const set = (updater: T | ((prev: T) => T)): void => {
        const next =
            typeof updater === 'function'
                ? (updater as (prev: T) => T)(box.value)
                : updater;
        box.value = next;
        notify(next);
    };
    return {
        get current(): T {
            return box.value;
        },
        set,
    };
}

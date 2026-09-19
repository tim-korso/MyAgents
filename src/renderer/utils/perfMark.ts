/**
 * Renderer perf instrumentation (P0). No-op unless enabled, so call sites are
 * safe to leave in production. Enabled in dev (Vite dev server) OR a debug build
 * (build_dev.sh sets VITE_DEBUG_MODE=true — the same signals as @/utils/debug's
 * isDebugMode()), OR when `localStorage['myagents:perf'] === '1'` (to profile a
 * production build). The env is read directly here, rather than importing
 * debug.ts, to avoid its `__DEBUG_MODE__` vite-define global under unit tests.
 *
 * Two outputs when enabled: (1) `performance.mark/measure` for the devtools
 * Performance panel; (2) a stable `[perf] trace=renderer phase=...` line emitted
 * via `console.debug`, which `frontendLogger` intercepts and forwards to the
 * unified log — so perf is greppable, NOT a parallel observability system. The
 * line shape reuses the shared perf-trace vocabulary (`@/shared/perfTrace`),
 * the same field vocabulary as the server-side perf-trace contract.
 *
 * See specs/prd/prd_0.2.31_frontend_perf_round1.md §P0.
 */

import { formatPerfLine, type PerfTraceDetail } from '../../shared/perfTrace';

/** Pure gating decision — unit-tested directly (debug-flag/localStorage injected). */
export function isPerfEnabled(isDebug: boolean, lsGet: (key: string) => string | null): boolean {
    if (isDebug) return true;
    try {
        return lsGet('myagents:perf') === '1';
    } catch {
        return false;
    }
}

const ENABLED = isPerfEnabled(
    Boolean(import.meta.env?.DEV) || import.meta.env?.VITE_DEBUG_MODE === 'true',
    (key) => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null),
);

/**
 * Mark a renderer interaction phase. `phase` is a `RENDERER_PERF_PHASE` value or
 * a free-form sub-phase (e.g. `tab_cache_hit`); `detail` carries structured
 * context (tabId, surface, …).
 */
export function perfMark(phase: string, detail?: PerfTraceDetail): void {
    if (!ENABLED) return;
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        try {
            performance.mark(phase);
        } catch {
            // best-effort — never throw into a render path
        }
    }
    try {
        // frontendLogger intercepts console.debug → unified log
        console.debug(formatPerfLine({ trace: 'renderer', phase, detail }));
    } catch {
        // ignore
    }
}

export function perfMeasure(name: string, startMark: string, endMark: string): void {
    if (!ENABLED) return;
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
    try {
        performance.measure(name, startMark, endMark);
        const entry = performance.getEntriesByName?.(name).pop();
        const durationMs = entry ? Math.round(entry.duration) : undefined;
        console.debug(formatPerfLine({ trace: 'renderer', phase: name, durationMs }));
    } catch {
        // ignore — e.g. a start mark that never fired
    }
}

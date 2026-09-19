import { useCallback, useLayoutEffect, useRef } from 'react';

import { isPendingSessionId } from '../../shared/constants';

/** Tab-owned, transient active-query time. Presentation mounts only sample it. */
export function useQueryElapsedClock(active: boolean, waitingForUser: boolean, sessionId: string | null) {
  const clock = useRef({
    sessionId,
    elapsedMs: 0,
    runningSince: null as number | null,
  });

  useLayoutEffect(() => {
    const now = performance.now();
    const previous = clock.current;
    // Materializing the initial pending identity is still the same query.
    const switchedSession = previous.sessionId !== sessionId
      && previous.sessionId !== null
      && !isPendingSessionId(previous.sessionId);
    const elapsedMs = !active || switchedSession
      ? 0
      : previous.elapsedMs + (previous.runningSince === null ? 0 : now - previous.runningSince);
    clock.current = {
      sessionId,
      elapsedMs,
      runningSince: active && !waitingForUser ? now : null,
    };
  }, [active, waitingForUser, sessionId]);

  // No per-second TabProvider/Chat/list renders. The small status row owns its
  // sampling interval; the clock continues through hidden/unmounted views.
  const getElapsedSeconds = useCallback(() => {
    const { elapsedMs, runningSince } = clock.current;
    return Math.floor(Math.max(0, elapsedMs + (runningSince === null ? 0 : performance.now() - runningSince)) / 1000);
  }, []);

  // Queue promotion can begin a new query without an inactive Session edge.
  // Reset only this clock, preserving its running/paused state and ownership.
  const reset = useCallback(() => {
    clock.current.elapsedMs = 0;
    if (clock.current.runningSince !== null) clock.current.runningSince = performance.now();
  }, []);

  return { getElapsedSeconds, reset };
}

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  actions,
  getSnapshot,
  subscribe,
  SPACE_VISIBLE_REFRESH_TTL_MS,
  type SpaceDataSnapshot,
} from "./spaceStore";

export interface UseSpaceDataOptions {
  isActive?: boolean;
}

export function useSpaceData({
  isActive,
}: UseSpaceDataOptions): SpaceDataSnapshot {
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const prevActiveRef = useRef(isActive);
  const accountPlanTier = data.session?.accountPlan?.effectiveTier;
  const accountPlanEvaluatedAt = data.session?.accountPlan?.evaluatedAt;
  const accountPlanExpiresAt = data.session?.accountPlan?.membership?.expiresAt;
  const accountPlanVersion = data.session?.accountPlan?.membership?.version;
  const planBoundaryAttemptRef = useRef<{
    key: string;
    attemptedAt: number;
  } | null>(null);

  useEffect(() => {
    const wasInactive = !prevActiveRef.current;
    prevActiveRef.current = isActive;
    if (wasInactive && isActive) {
      void actions.ensureBootstrapped({
        silent: true,
        maxAgeMs: SPACE_VISIBLE_REFRESH_TTL_MS,
      });
    }
  }, [isActive]);

  useEffect(() => {
    const expiresAt = accountPlanTier === "pro" ? accountPlanExpiresAt : null;
    if (!isActive || !expiresAt) return;
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;
    const evaluatedAtMs = Date.parse(accountPlanEvaluatedAt ?? "");
    const projectionKey = `${accountPlanVersion ?? 0}:${expiresAt}`;
    const localDeadlineMs = Number.isFinite(evaluatedAtMs)
      ? Date.now() + Math.max(0, expiresAtMs - evaluatedAtMs)
      : expiresAtMs;
    let cancelled = false;
    let timer: number | null = null;
    const refreshExpiredProjection = () => {
      if (cancelled) return;
      const now = Date.now();
      const previousAttempt = planBoundaryAttemptRef.current;
      if (
        previousAttempt?.key === projectionKey &&
        now - previousAttempt.attemptedAt < 60_000
      ) {
        return;
      }
      planBoundaryAttemptRef.current = { key: projectionKey, attemptedAt: now };
      void actions.ensureBootstrapped({ force: true, silent: true });
    };
    const scheduleBoundaryRefresh = () => {
      if (cancelled) return;
      if (Date.now() >= localDeadlineMs) {
        refreshExpiredProjection();
        return;
      }
      timer = window.setTimeout(
        scheduleBoundaryRefresh,
        Math.min(localDeadlineMs - Date.now() + 50, 2_147_000_000),
      );
    };
    scheduleBoundaryRefresh();
    const refreshWhenVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() >= localDeadlineMs
      ) {
        refreshExpiredProjection();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    accountPlanEvaluatedAt,
    accountPlanExpiresAt,
    accountPlanTier,
    accountPlanVersion,
    isActive,
  ]);

  return data;
}

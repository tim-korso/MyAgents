import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpaceSession } from "@/api/spaceCloud";
import {
  __resetSpaceStoreForTest,
  __setSpaceStoreStateForTest,
  actions,
} from "./spaceStore";
import { useSpaceData } from "./useSpaceData";

function proSession(evaluatedAt: string, expiresAt: string): SpaceSession {
  return {
    baseUrl: "https://space.myagents.test",
    user: { id: "usr_test", email: "user@example.com" },
    accountPlan: {
      effectiveTier: "pro",
      evaluatedAt,
      membership: {
        planTier: "pro",
        status: "active",
        startsAt: "2026-07-01T00:00:00.000Z",
        expiresAt,
        revokedAt: null,
        source: "test",
        version: 7,
      },
    },
    space: {
      id: "space-1",
      slug: "official",
      name: "MyAgents",
      joinPolicy: "open",
    },
    membership: { id: "membership-1", role: "owner" },
    updatedAt: evaluatedAt,
  };
}

describe("useSpaceData plan expiry refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSpaceStoreForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __resetSpaceStoreForTest();
  });

  it("uses server evaluation time instead of local clock skew for the boundary", async () => {
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    __setSpaceStoreStateForTest({
      boot: "ready",
      session: proSession(
        "2026-07-11T10:00:00.000Z",
        "2026-07-11T10:01:00.000Z",
      ),
    });
    const refresh = vi
      .spyOn(actions, "ensureBootstrapped")
      .mockResolvedValue(undefined);

    renderHook(() => useSpaceData({ isActive: true }));
    await act(async () => vi.advanceTimersByTime(59_000));
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1_100));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the refreshed projection still contains the same Pro expiry", async () => {
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    const expiresAt = "2026-07-11T10:00:01.000Z";
    __setSpaceStoreStateForTest({
      boot: "ready",
      session: proSession("2026-07-11T10:00:00.000Z", expiresAt),
    });
    const refresh = vi
      .spyOn(actions, "ensureBootstrapped")
      .mockResolvedValue(undefined);

    renderHook(() => useSpaceData({ isActive: true }));
    await act(async () => vi.advanceTimersByTime(1_100));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      __setSpaceStoreStateForTest({
        session: proSession("2026-07-11T10:00:02.000Z", expiresAt),
      });
    });
    await act(async () => vi.advanceTimersByTime(30_000));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

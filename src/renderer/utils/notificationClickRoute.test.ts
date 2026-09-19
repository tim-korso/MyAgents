import { describe, expect, test } from "vitest";

import { resolveNotificationClickRoute } from "./notificationClickRoute";

describe("resolveNotificationClickRoute", () => {
  test("selects an existing tab when tabId is still live", () => {
    expect(
      resolveNotificationClickRoute(
        { tabId: "tab-a", sessionId: "session-a", workspacePath: "/workspace" },
        (tabId, sessionId) => tabId === "tab-a" && sessionId === "session-a",
      ),
    ).toEqual({ type: "select-tab", tabId: "tab-a", sessionId: "session-a" });
  });

  test("opens the session when a live tab no longer owns the notification session", () => {
    expect(
      resolveNotificationClickRoute(
        { tabId: "tab-a", sessionId: "session-a", workspacePath: "/workspace" },
        (tabId, sessionId) => tabId === "tab-a" && sessionId === "session-b",
      ),
    ).toEqual({
      type: "open-session",
      sessionId: "session-a",
      workspacePath: "/workspace",
    });
  });

  test("opens the session when the notification has no live tab target", () => {
    expect(
      resolveNotificationClickRoute(
        {
          tabId: "stale-tab",
          sessionId: "session-a",
          workspacePath: "/workspace",
        },
        () => false,
      ),
    ).toEqual({
      type: "open-session",
      sessionId: "session-a",
      workspacePath: "/workspace",
    });
  });

  test("returns none for notifications without a routable target", () => {
    expect(
      resolveNotificationClickRoute({ tabId: "missing-tab" }, () => false),
    ).toEqual({ type: "none" });
  });
});

export interface NotificationClickPayload {
  tabId?: string;
  sessionId?: string;
  workspacePath?: string;
}

export type NotificationClickRoute =
  | { type: "select-tab"; tabId: string; sessionId?: string }
  | { type: "open-session"; sessionId: string; workspacePath: string }
  | { type: "none" };

export function resolveNotificationClickRoute(
  payload: NotificationClickPayload | null | undefined,
  tabMatches: (tabId: string, sessionId?: string) => boolean,
): NotificationClickRoute {
  const tabId = payload?.tabId?.trim();
  const sessionId = payload?.sessionId?.trim();
  if (tabId && tabMatches(tabId, sessionId)) {
    return sessionId
      ? { type: "select-tab", tabId, sessionId }
      : { type: "select-tab", tabId };
  }

  const workspacePath = payload?.workspacePath?.trim();
  if (sessionId && workspacePath) {
    return { type: "open-session", sessionId, workspacePath };
  }

  return { type: "none" };
}

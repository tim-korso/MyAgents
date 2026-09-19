export interface InitialMessageAutoSendGate {
  hasInitialMessage: boolean;
  alreadyConsumed: boolean;
  hasSessionId: boolean;
  isConnected: boolean;
  isActive: boolean;
  runtimeReady?: boolean;
}

/**
 * Launcher handoff is already an explicit user send. Once the target Chat tab
 * has a session and SSE connection, it must submit even if the user switched
 * away during startup.
 */
export function shouldAutoSendInitialMessage(args: InitialMessageAutoSendGate): boolean {
  if (!args.hasInitialMessage) return false;
  if (args.alreadyConsumed) return false;
  if (!args.hasSessionId) return false;
  if (!args.isConnected) return false;
  if (args.runtimeReady === false) return false;
  return true;
}

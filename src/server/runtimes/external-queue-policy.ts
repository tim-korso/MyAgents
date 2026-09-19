import type { ChatQueueResponseMode } from '../../shared/config-types';

/**
 * Pure policy for the external-runtime mid-turn message queue.
 *
 * Most external runtimes are turn-level: each `sendMessage` starts a NEW turn,
 * so a message typed while a turn is running must wait in MyAgents' queue.
 * Codex app-server is the exception: `turn/steer` can append user input to the
 * active turn. The policy keeps that as an explicit capability instead of
 * letting external-session infer protocol details from runtime names.
 *
 * Functional Core / Imperative Shell: these are the queue decisions; the shell
 * in external-session.ts owns queue arrays, broadcasts, and runtime calls.
 */
export type ExternalQueueState = 'idle' | 'running' | 'error';

/**
 * Should a desktop send be DEFERRED into the queue instead of sent immediately?
 * Defer behind existing queued work to preserve FIFO. When a turn is running,
 * only bypass the queue for realtime mode on a runtime with active-turn steering.
 */
export function shouldQueueExternalSend(params: {
  state: ExternalQueueState;
  queueLength: number;
  responseMode: ChatQueueResponseMode;
  canSteerActiveTurn: boolean;
}): boolean {
  if (params.queueLength > 0) return true;
  if (params.state !== 'running') return false;
  return !(params.responseMode === 'realtime' && params.canSteerActiveTurn);
}

/**
 * May the queue be drained NOW (surface + send exactly one item)? Only when the session is
 * idle (a turn just ended / was interrupted) and something is queued. Guards against
 * draining mid-turn or on a spurious idle with an empty queue.
 */
export function canDrainExternalQueue(state: ExternalQueueState, queueLength: number): boolean {
  return state === 'idle' && queueLength > 0;
}

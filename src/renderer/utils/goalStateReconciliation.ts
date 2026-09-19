import type { SessionGoal } from '@/types/sessionGoal';

function isTerminal(goal: SessionGoal): boolean {
  return goal.status === 'complete'
    || goal.status === 'blocked'
    || goal.status === 'canceled';
}

function stateTime(goal: SessionGoal): number {
  const parsed = Date.parse(goal.updatedAt ?? goal.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Accept only state that cannot move the visible Goal backwards. */
export function shouldAcceptGoalState(incoming: SessionGoal, current: SessionGoal | null): boolean {
  if (!current) return true;
  if (incoming.id !== current.id) {
    if (isTerminal(incoming) !== isTerminal(current)) return !isTerminal(incoming);
    return stateTime(incoming) >= stateTime(current);
  }
  if (isTerminal(current) && !isTerminal(incoming)) return false;
  return incoming.revision >= current.revision;
}

export function projectGoalExecutionState(goal: SessionGoal): {
  isExecuting: boolean;
  executionNumber: number | undefined;
} {
  return {
    isExecuting: goal.isExecuting,
    executionNumber: goal.executionNumber,
  };
}

/** Recover only a terminal transition that could have landed before listeners attached. */
export function isTerminalGoalFromListenerGap(
  goal: SessionGoal,
  listenerStartedAt: number,
  listenersReadyAt: number | null,
): boolean {
  if (!isTerminal(goal) || listenersReadyAt === null) return false;
  const changedAt = stateTime(goal);
  return changedAt >= listenerStartedAt && changedAt <= listenersReadyAt;
}

import { describe, expect, it } from 'vitest';

import type { SessionGoal } from '@/types/sessionGoal';
import {
  isTerminalGoalFromListenerGap,
  projectGoalExecutionState,
  shouldAcceptGoalState,
} from './goalStateReconciliation';

function goal(overrides: Partial<SessionGoal>): SessionGoal {
  return {
    id: 'goal-1',
    workspacePath: '/tmp/workspace',
    sessionId: 'session-1',
    objective: 'ship it',
    endConditions: { aiCanExit: true },
    status: 'active',
    turnCount: 1,
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    totalDurationMs: 0,
    totalTokens: 0,
    notifyEnabled: true,
    permissionMode: '',
    revision: 1,
    controlRevision: 1,
    isExecuting: false,
    ...overrides,
  };
}

describe('Goal state reconciliation', () => {
  it('rejects stale hydrate after a terminal event', () => {
    const terminal = goal({
      status: 'complete',
      revision: 3,
    });
    expect(shouldAcceptGoalState(goal({ revision: 2 }), terminal)).toBe(false);
  });

  it('accepts a newer revision and a newer Goal after a prior terminal Goal', () => {
    expect(shouldAcceptGoalState(goal({ revision: 4 }), goal({ revision: 3 }))).toBe(true);
    expect(shouldAcceptGoalState(goal({
      id: 'goal-2',
      createdAt: '2026-07-10T11:00:00.000Z',
      updatedAt: '2026-07-10T11:00:00.000Z',
    }), goal({
      status: 'canceled',
      updatedAt: '2026-07-10T10:30:00.000Z',
    }))).toBe(true);
  });

  it('keeps the unfinished Session Goal ahead of newer terminal history', () => {
    expect(shouldAcceptGoalState(goal({
      id: 'goal-2',
      status: 'complete',
      updatedAt: '2026-07-10T11:00:00.000Z',
    }), goal({
      id: 'goal-1',
      status: 'active',
      updatedAt: '2026-07-10T10:30:00.000Z',
    }))).toBe(false);
  });

  it('recovers terminal state only from the listener registration gap', () => {
    const terminal = goal({
      status: 'complete',
      updatedAt: '2026-07-10T10:00:05.000Z',
    });
    expect(isTerminalGoalFromListenerGap(
      terminal,
      Date.parse('2026-07-10T10:00:00.000Z'),
      Date.parse('2026-07-10T10:00:10.000Z'),
    )).toBe(true);
    expect(isTerminalGoalFromListenerGap(
      terminal,
      Date.parse('2026-07-10T10:00:06.000Z'),
      Date.parse('2026-07-10T10:00:10.000Z'),
    )).toBe(false);
    expect(isTerminalGoalFromListenerGap(goal({ updatedAt: '2026-07-10T10:00:05.000Z' }), 0, Infinity))
      .toBe(false);
  });

  it('projects only the product execution fields exposed by the Goal view', () => {
    expect(projectGoalExecutionState(goal({
      isExecuting: false,
    }))).toEqual({ isExecuting: false, executionNumber: undefined });

    expect(projectGoalExecutionState(goal({
      isExecuting: true,
      executionNumber: 2,
    }))).toEqual({ isExecuting: true, executionNumber: 2 });
  });
});

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionGoal } from '@/types/sessionGoal';
import { useSessionGoal } from './useSessionGoal';

const api = vi.hoisted(() => ({
  createSessionGoal: vi.fn(),
  markSessionGoalTerminal: vi.fn(),
  pauseSessionGoal: vi.fn(),
  resumeSessionGoal: vi.fn(),
}));

vi.mock('@/api/sessionGoalClient', () => ({
  createSessionGoal: api.createSessionGoal,
  getSessionGoal: vi.fn(),
  markSessionGoalTerminal: api.markSessionGoalTerminal,
  pauseSessionGoal: api.pauseSessionGoal,
  resumeSessionGoal: api.resumeSessionGoal,
}));

const createdGoal: SessionGoal = {
  id: 'goal-1',
  workspacePath: '/tmp/workspace',
  sessionId: 'session-1',
  objective: 'finish release',
  endConditions: { aiCanExit: true },
  status: 'paused',
  turnCount: 0,
  createdAt: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
  totalDurationMs: 0,
  totalTokens: 0,
  notifyEnabled: true,
  permissionMode: '',
  revision: 1,
  controlRevision: 1,
  isExecuting: false,
};

describe('useSessionGoal creation surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createSessionGoal.mockResolvedValue(createdGoal);
    api.markSessionGoalTerminal.mockResolvedValue({ ...createdGoal, status: 'canceled' });
    api.pauseSessionGoal.mockResolvedValue({ ...createdGoal, status: 'paused', revision: 2 });
    api.resumeSessionGoal.mockResolvedValue({ ...createdGoal, status: 'active', revision: 2 });
  });

  it('creates only through an explicit Goal draft and keeps the returned projection', async () => {
    const { result } = renderHook(() => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId: 'session-1',
    }));

    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: '',
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
        permissionMode: 'fullAgency',
      }, 'finish release');
    });

    expect(api.createSessionGoal).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'finish release',
      permissionMode: 'fullAgency',
    }));
    expect(api.createSessionGoal).toHaveBeenCalledWith(expect.not.objectContaining({
      tabId: expect.anything(),
      providerIntent: expect.anything(),
      runtime: expect.anything(),
      delivery: expect.anything(),
      goalStatus: expect.anything(),
      schedule: expect.anything(),
    }));
    expect(result.current.state.goal?.id).toBe('goal-1');
  });

  it('cancels an in-flight create only after an explicit draft cancel', async () => {
    let resolveCreate!: (goal: SessionGoal) => void;
    api.createSessionGoal.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    const { result } = renderHook(() => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId: 'session-1',
    }));
    const config = {
      taskKind: 'goal' as const,
      prompt: 'finish release',
      endConditions: { aiCanExit: true },
      notifyEnabled: true,
    };

    let startPromise!: ReturnType<typeof result.current.start>;
    act(() => { startPromise = result.current.start(config); });
    act(() => result.current.cancelPendingStart());
    await act(async () => { resolveCreate(createdGoal); });

    await expect(startPromise).resolves.toBeNull();
    expect(api.markSessionGoalTerminal).toHaveBeenCalledWith(
      'goal-1',
      'canceled',
      'Canceled before Goal Mode started',
    );
  });

  it('does not cancel a Rust-accepted Goal merely because its Tab unmounts', async () => {
    let resolveCreate!: (goal: SessionGoal) => void;
    api.createSessionGoal.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    const { result, unmount } = renderHook(() => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId: 'session-1',
    }));
    const startPromise = result.current.start({
      taskKind: 'goal',
      prompt: 'finish release',
      endConditions: { aiCanExit: true },
      notifyEnabled: true,
    });

    unmount();
    resolveCreate(createdGoal);

    await expect(startPromise).resolves.toBeNull();
    expect(api.markSessionGoalTerminal).not.toHaveBeenCalled();
  });

  it('preserves an accepted Goal while the Tab adopts its pre-materialized identity', async () => {
    const realGoal = { ...createdGoal, sessionId: 'session-real' };
    api.createSessionGoal.mockResolvedValue(realGoal);
    const materializeOwner = vi.fn(async () => ({
      sessionId: 'session-real',
      workspacePath: '/tmp/workspace',
    }));
    const { result, rerender } = renderHook(({ sessionId }) => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId,
      materializeOwner,
    }), { initialProps: { sessionId: 'pending-tab-1' } });

    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: 'finish release',
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });
    expect(api.createSessionGoal).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-real',
    }));
    expect(result.current.state.goal?.sessionId).toBe('session-real');

    act(() => {
      rerender({ sessionId: 'session-real' });
    });

    expect(result.current.state.goal?.sessionId).toBe('session-real');
  });

  it('cancels the whole materialize-and-create operation before Goal persistence', async () => {
    let resolveMaterialize!: (owner: { sessionId: string; workspacePath: string }) => void;
    const materializeOwner = vi.fn(() => new Promise<{ sessionId: string; workspacePath: string }>(
      resolve => { resolveMaterialize = resolve; },
    ));
    const { result } = renderHook(() => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId: 'pending-tab-1',
      materializeOwner,
    }));

    let startPromise!: ReturnType<typeof result.current.start>;
    act(() => {
      startPromise = result.current.start({
        taskKind: 'goal',
        prompt: 'finish release',
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });
    act(() => result.current.cancelPendingStart());
    await act(async () => {
      resolveMaterialize({ sessionId: 'session-real', workspacePath: '/tmp/workspace' });
    });

    await expect(startPromise).resolves.toBeNull();
    expect(api.createSessionGoal).not.toHaveBeenCalled();
  });

  it('detaches an in-flight create when the Tab switches to same-workspace history', async () => {
    const pendingGoal = { ...createdGoal, sessionId: 'pending-tab-1' };
    let resolveCreate!: (goal: SessionGoal) => void;
    api.createSessionGoal.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    const { result, rerender } = renderHook(({ sessionId }) => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId,
    }), { initialProps: { sessionId: 'pending-tab-1' } });

    let startPromise!: ReturnType<typeof result.current.start>;
    act(() => {
      startPromise = result.current.start({
        taskKind: 'goal',
        prompt: 'finish release',
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });
    act(() => rerender({ sessionId: 'unrelated-history' }));
    await act(async () => { resolveCreate(pendingGoal); });

    await expect(startPromise).resolves.toBeNull();
    expect(result.current.state.goal).toBeNull();
    expect(result.current.state.isStarting).toBe(false);
    expect(api.markSessionGoalTerminal).not.toHaveBeenCalled();
  });

  it.each([
    ['pause', 'active', api.pauseSessionGoal],
    ['resume', 'paused', api.resumeSessionGoal],
  ] as const)('does not project a late %s response into a different Session', async (
    operation,
    initialStatus,
    operationMock,
  ) => {
    const goalA = { ...createdGoal, status: initialStatus } as SessionGoal;
    const goalB = {
      ...createdGoal,
      id: 'goal-2',
      sessionId: 'session-2',
      objective: 'ship session two',
    };
    api.createSessionGoal.mockResolvedValueOnce(goalA).mockResolvedValueOnce(goalB);
    let resolveOperation!: (goal: SessionGoal) => void;
    operationMock.mockImplementationOnce(() => new Promise(resolve => {
      resolveOperation = resolve;
    }));
    const { result, rerender } = renderHook(({ sessionId }) => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId,
    }), { initialProps: { sessionId: 'session-1' } });

    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: goalA.objective,
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });
    let operationPromise!: Promise<SessionGoal | null>;
    act(() => {
      operationPromise = operation === 'pause'
        ? result.current.pause()
        : result.current.resume();
    });
    act(() => rerender({ sessionId: 'session-2' }));
    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: goalB.objective,
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });

    await act(async () => {
      resolveOperation({ ...goalA, status: operation === 'pause' ? 'paused' : 'active', revision: 2 });
      await operationPromise;
    });

    expect(result.current.state.goal?.id).toBe('goal-2');
    expect(result.current.state.goal?.sessionId).toBe('session-2');
  });

  it('does not clear a new Session Goal when an old cancel response arrives late', async () => {
    const goalB = {
      ...createdGoal,
      id: 'goal-2',
      sessionId: 'session-2',
      objective: 'ship session two',
    };
    api.createSessionGoal.mockResolvedValueOnce(createdGoal).mockResolvedValueOnce(goalB);
    let resolveCancel!: (goal: SessionGoal) => void;
    api.markSessionGoalTerminal.mockImplementationOnce(() => new Promise(resolve => {
      resolveCancel = resolve;
    }));
    const { result, rerender } = renderHook(({ sessionId }) => useSessionGoal({
      workspacePath: '/tmp/workspace',
      sessionId,
    }), { initialProps: { sessionId: 'session-1' } });

    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: createdGoal.objective,
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });
    let cancelPromise!: ReturnType<typeof result.current.cancel>;
    act(() => { cancelPromise = result.current.cancel(); });
    act(() => rerender({ sessionId: 'session-2' }));
    await act(async () => {
      await result.current.start({
        taskKind: 'goal',
        prompt: goalB.objective,
        endConditions: { aiCanExit: true },
        notifyEnabled: true,
      });
    });

    await act(async () => {
      resolveCancel({ ...createdGoal, status: 'canceled', revision: 2 });
      await cancelPromise;
    });

    expect(result.current.state.goal?.id).toBe('goal-2');
    expect(result.current.state.goal?.sessionId).toBe('session-2');
  });
});

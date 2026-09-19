import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCronTask, stopCronTask } from '@/api/cronTaskClient';
import type { CronTask } from '@/types/cronTask';
import { useCronTask } from './useCronTask';

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock('@/api/cronTaskClient', () => ({
  createAndStartCronTask: vi.fn(),
  stopCronTask: vi.fn(),
  getCronTask: vi.fn(),
}));
vi.mock('@/analytics', () => ({ track: vi.fn() }));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/utils/tauriListen', () => ({
  listenWithCleanup: vi.fn(async (name, handler, signal: AbortSignal) => {
    listeners.set(name, handler);
    signal.addEventListener('abort', () => listeners.delete(name));
  }),
}));
function task(id: string): CronTask {
  return {
    id,
    workspacePath: '/tmp/workspace',
    sessionId: 'A',
    prompt: 'work',
    intervalMinutes: 5,
    endConditions: { aiCanExit: true },
    runMode: 'single_session',
    status: 'running',
    executionCount: 0,
    createdAt: '2026-09-18T00:00:00Z',
    notifyEnabled: false,
    schedule: { kind: 'every', minutes: 5 },
  };
}

describe('Task snapshot receipt ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });
  it.each(['cron:execution-complete', 'cron:execution-error', 'cron:task-stopped', 'refresh'])(
    '%s ignores a replaced Task and its callbacks',
    async (event) => {
      let finish!: (value: CronTask) => void;
      vi.mocked(getCronTask).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const onComplete = vi.fn();
      const onExecutionComplete = vi.fn();
      const { result } = renderHook(() =>
        useCronTask({
          workspacePath: '/tmp/workspace',
          sessionId: 'A',
          materializeOwner: async () => ({ sessionId: 'A', workspacePath: '/tmp/workspace' }),
          onComplete,
          onExecutionComplete,
        }),
      );
      act(() => result.current.restoreFromTask(task('old')));
      act(() => {
        if (event === 'refresh') void result.current.refresh();
        else
          listeners.get(event)!({
            payload: { taskId: 'old', success: true, executionCount: 1, error: 'old error' },
          });
      });
      await waitFor(() => expect(getCronTask).toHaveBeenCalledTimes(1));
      act(() => result.current.restoreFromTask(task('new')));
      await act(async () => {
        finish({ ...task('old'), status: 'stopped', exitReason: 'complete' });
      });
      expect(result.current.state.task?.id).toBe('new');
      expect(onComplete).not.toHaveBeenCalled();
      expect(onExecutionComplete).not.toHaveBeenCalled();
    },
  );
  it('does not notify the next Session even if the old task projection is still present', async () => {
    let finish!: (value: CronTask) => void;
    vi.mocked(getCronTask).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onExecutionComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useCronTask({
          workspacePath: '/tmp/workspace',
          sessionId,
          materializeOwner: async () => ({ sessionId, workspacePath: '/tmp/workspace' }),
          onExecutionComplete,
        }),
      { initialProps: { sessionId: 'A' } },
    );
    act(() => result.current.restoreFromTask(task('old')));
    act(() =>
      listeners.get('cron:execution-complete')!({
        payload: { taskId: 'old', success: true, executionCount: 1 },
      }),
    );
    rerender({ sessionId: 'B' });
    await act(async () => {
      finish(task('old'));
    });
    expect(onExecutionComplete).not.toHaveBeenCalled();
  });
  it('ignores an old Task event first received after switching Session', async () => {
    vi.mocked(getCronTask).mockResolvedValue({ ...task('old'), executionCount: 1 });
    const onExecutionComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useCronTask({
          workspacePath: '/tmp/workspace',
          sessionId,
          materializeOwner: async () => ({ sessionId, workspacePath: '/tmp/workspace' }),
          onExecutionComplete,
        }),
      { initialProps: { sessionId: 'A' } },
    );
    act(() => result.current.restoreFromTask(task('old')));
    rerender({ sessionId: 'B' });
    await act(async () => {
      listeners.get('cron:execution-complete')!({
        payload: { taskId: 'old', success: true, executionCount: 1 },
      });
    });
    expect(result.current.state.task?.executionCount).toBe(0);
    expect(onExecutionComplete).not.toHaveBeenCalled();
  });
  it('accepts the internal Session binding used by historical IM Task records', async () => {
    const imTask = { ...task('im'), sessionId: 'im-sidecar-key', internalSessionId: 'A', executionCount: 1 };
    vi.mocked(getCronTask).mockResolvedValue(imTask);
    const onExecutionComplete = vi.fn();
    const { result } = renderHook(() =>
      useCronTask({
        workspacePath: '/tmp/workspace',
        sessionId: 'A',
        materializeOwner: async () => ({ sessionId: 'A', workspacePath: '/tmp/workspace' }),
        onExecutionComplete,
      }),
    );
    act(() => result.current.restoreFromTask(imTask));
    await act(async () => {
      listeners.get('cron:execution-complete')!({
        payload: { taskId: 'im', success: true, executionCount: 1 },
      });
    });
    expect(onExecutionComplete).toHaveBeenCalledOnce();
  });
  it.each(['terminal-event', 'new-task', 'new-session'] as const)(
    'returns a successful stop receipt after %s without clearing a replacement projection',
    async (scenario) => {
      let finish!: (value: CronTask) => void;
      const stoppedTask = { ...task('old'), status: 'stopped' as const, exitReason: 'manual' };
      vi.mocked(stopCronTask).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      vi.mocked(getCronTask).mockResolvedValue(stoppedTask);
      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useCronTask({
            workspacePath: '/tmp/workspace',
            sessionId,
            materializeOwner: async () => ({ sessionId, workspacePath: '/tmp/workspace' }),
          }),
        { initialProps: { sessionId: 'A' } },
      );
      act(() => result.current.restoreFromTask(task('old')));
      let receipt!: ReturnType<typeof result.current.stop>;
      act(() => {
        receipt = result.current.stop();
      });
      if (scenario === 'terminal-event') {
        await act(async () => {
          listeners.get('cron:task-stopped')!({ payload: { taskId: 'old' } });
        });
        expect(result.current.state.task).toBeNull();
      } else if (scenario === 'new-task') {
        act(() => result.current.restoreFromTask(task('new')));
      } else {
        rerender({ sessionId: 'B' });
      }
      await act(async () => {
        finish(stoppedTask);
        await expect(receipt).resolves.toEqual({ task: stoppedTask, prompt: 'work' });
      });
      expect(result.current.state.task?.id ?? null).toBe(
        scenario === 'terminal-event' ? null : scenario === 'new-task' ? 'new' : 'old',
      );
    },
  );
  it('projects a current receipt and calls the current completion handler', async () => {
    vi.mocked(getCronTask).mockResolvedValue({ ...task('current'), executionCount: 1 });
    const onExecutionComplete = vi.fn();
    const { result } = renderHook(() =>
      useCronTask({
        workspacePath: '/tmp/workspace',
        sessionId: 'A',
        materializeOwner: async () => ({ sessionId: 'A', workspacePath: '/tmp/workspace' }),
        onExecutionComplete,
      }),
    );
    act(() => result.current.restoreFromTask(task('current')));
    act(() =>
      listeners.get('cron:execution-complete')!({
        payload: { taskId: 'current', success: true, executionCount: 1 },
      }),
    );
    await waitFor(() => expect(result.current.state.task?.executionCount).toBe(1));
    expect(onExecutionComplete).toHaveBeenCalledOnce();
  });
});

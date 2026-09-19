import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEventHandler } from '@/api/SseConnection';
import { localDate } from '../../shared/logTime';
import { useFloatingSession } from './useFloatingSession';

const harness = vi.hoisted(() => ({
  handler: null as SseEventHandler | null,
  fetch: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/api/SseConnection', () => ({
  createSseConnection: () => ({
    setEventHandler: (handler: SseEventHandler) => {
      harness.handler = handler;
    },
    connect: async () => {},
    disconnect: async () => {},
    getConnectionGeneration: () => 1,
  }),
}));
vi.mock('@/api/tauriClient', () => ({
  ensureSessionSidecar: async () => ({ isNew: false }),
  getSessionPort: async () => 1234,
  sessionSidecarFetch: (...args: unknown[]) => harness.fetch(...args),
  releaseSessionSidecar: async () => false,
}));
vi.mock('@/config/services/appConfigService', () => ({
  loadAppConfig: () => harness.config(),
  atomicModifyConfig: vi.fn(),
}));
vi.mock('@/config/services/projectService', () => ({
  loadProjects: async () => [{ id: 'workspace', path: '/tmp/companion-test', name: 'Test' }],
}));
vi.mock('@/context/useTranscriptSaveToast', () => ({ useTranscriptSaveToast: () => vi.fn() }));
vi.mock('@/analytics', () => ({ initAnalytics: vi.fn(), setAnalyticsContext: vi.fn(), track: vi.fn() }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
const response = (body: unknown) => new Response(JSON.stringify(body));
const question = (requestId: string) => ({
  requestId,
  sessionId: 'companion-test',
  questions: [{ question: 'Continue?', options: [], multiSelect: false }],
});
function emit(requestId: string) {
  act(() =>
    harness.handler!('ask-user-question:request', question(requestId), {
      sessionId: 'companion-test',
      connectionGeneration: 1,
    }),
  );
}

describe('Companion question receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.handler = null;
    harness.config.mockResolvedValue({
      floatingBallSessionId: 'companion-test',
      floatingBallSessionDate: localDate(),
      floatingBallSessionWorkspace: '/tmp/companion-test',
      defaultWorkspacePath: '/tmp/companion-test',
    });
    harness.fetch.mockImplementation(async (_sid, _owner, path) => {
      if (path.startsWith('/sessions/'))
        return response({ success: true, session: { id: 'companion-test', messages: [] } });
      throw new Error(`Unexpected route: ${path}`);
    });
  });
  it.each(['chat:message-complete', 'chat:message-stopped', 'chat:message-error', 'chat:agent-error'])(
    'keeps accepted queued replies busy across %s until backend idle', async terminal => {
      const { result } = renderHook(() => useFloatingSession({ current: 'pin' }));
      await waitFor(() => expect(result.current.ready).toBe(true));
      const event = (name: string, data: unknown) => act(() => harness.handler!(name, data, {
        sessionId: 'companion-test', connectionGeneration: 1,
      }));
      event('chat:status', { sessionState: 'running' });
      event('chat:message-chunk', 'first reply');
      event(terminal, { message: 'first turn ended' });
      expect(result.current.busy).toBe(true);
      event('queue:started', { sessionId: 'companion-test', queueId: 'next', userMessage: {
        id: 'reply', role: 'user', content: 'yes', timestamp: new Date(0).toISOString(),
        asyncQuestionReply: { questionId: 'q1', questionIndex: 0 },
      } });
      expect(result.current.messages.some(message => message.id === 'reply')).toBe(true);
      expect(result.current.busy).toBe(true);
      event('chat:status', { sessionState: 'idle' });
      expect(result.current.busy).toBe(false);
    },
  );

  it.each(['reject', 'false'] as const)('propagates %s and retains the question for retry', async (mode) => {
    const modeRef = { current: 'pin' as const };
    const { result } = renderHook(() => useFloatingSession(modeRef));
    await waitFor(() => expect(result.current.ready).toBe(true));
    emit('q1');
    if (mode === 'reject') harness.fetch.mockRejectedValueOnce(new Error('offline'));
    else harness.fetch.mockResolvedValueOnce(response({ success: false }));
    await act(async () => {
      await expect(result.current.respondAskUserQuestion('q1', null)).rejects.toThrow();
    });
    expect(result.current.askReq?.requestId).toBe('q1');
    harness.fetch.mockResolvedValueOnce(response({ success: true }));
    await act(async () => {
      await result.current.respondAskUserQuestion('q1', { '0': 'yes' });
    });
    expect(result.current.askReq).toBeNull();
    expect(JSON.parse(harness.fetch.mock.calls.at(-1)![3].body)).toEqual({
      requestId: 'q1',
      answers: { '0': 'yes' },
    });
  });
  it('does not clear a new question when an older request succeeds', async () => {
    const modeRef = { current: 'pin' as const };
    const { result } = renderHook(() => useFloatingSession(modeRef));
    await waitFor(() => expect(result.current.ready).toBe(true));
    emit('old');
    let finish!: (value: Response) => void;
    harness.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let receipt!: Promise<void>;
    act(() => {
      receipt = result.current.respondAskUserQuestion('old', null);
    });
    emit('new');
    await act(async () => {
      finish(response({ success: true }));
      await receipt;
    });
    expect(result.current.askReq?.requestId).toBe('new');
  });
});

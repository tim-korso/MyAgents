import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentStatuses, type AgentStatusMap } from './useAgentStatuses';

vi.mock('@/utils/browserMock', () => ({
  isTauriEnvironment: () => true,
}));

vi.mock('@/utils/tauriListen', () => ({
  listenWithCleanup: vi.fn(async () => ({
    unlisten: vi.fn(),
    isRegistered: () => true,
  })),
}));

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function status(agentName: string): AgentStatusMap {
  return {
    agent: {
      agentId: 'agent',
      agentName,
      enabled: true,
      channels: [],
    },
  };
}

function Probe() {
  const { statuses, loading, refresh } = useAgentStatuses(true);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="name">{statuses.agent?.agentName ?? 'none'}</span>
      <button type="button" onClick={refresh}>refresh</button>
    </div>
  );
}

describe('useAgentStatuses', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('ignores stale slower status responses after a newer refresh resolves', async () => {
    const first = deferred<AgentStatusMap>();
    const second = deferred<AgentStatusMap>();
    invokeMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<Probe />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    second.resolve(status('new'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('new'));

    first.resolve(status('stale'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('name')).toHaveTextContent('new');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});

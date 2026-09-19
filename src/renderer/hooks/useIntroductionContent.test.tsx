import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INTRODUCTION_FILE_PATH,
  isIntroductionAbsentError,
  shouldShowIntroductionOverlay,
  useIntroductionContent,
  type IntroductionReader,
} from './useIntroductionContent';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useIntroductionContent', () => {
  let readFile: ReturnType<typeof vi.fn<IntroductionReader>>;

  beforeEach(() => {
    readFile = vi.fn<IntroductionReader>();
  });

  it('reads INTRODUCTION.md through the workspace-relative path', () => {
    expect(INTRODUCTION_FILE_PATH).toBe('INTRODUCTION.md');
  });

  it('does not re-read when only unrelated render state changes', async () => {
    const first = deferred<string | null>();
    readFile.mockReturnValueOnce(first.promise);

    const { result, rerender } = renderHook(
      ({ sessionId }) => {
        void sessionId;
        return useIntroductionContent('/workspace', 0, readFile);
      },
      { initialProps: { sessionId: 'pending-tab' } },
    );

    expect(readFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve('# Welcome');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Welcome'));

    rerender({ sessionId: 'real-session' });

    expect(result.current).toBe('# Welcome');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('keeps the current content visible while refreshing the same workspace', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useIntroductionContent('/workspace', refreshKey, readFile),
      { initialProps: { refreshKey: 0 } },
    );

    await act(async () => {
      first.resolve('# Old');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Old'));

    rerender({ refreshKey: 1 });

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('# Old');

    await act(async () => {
      second.resolve('# New');
      await second.promise;
    });
    await waitFor(() => expect(result.current).toBe('# New'));
  });

  it('keeps the current content visible when a same-workspace refresh fails transiently', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useIntroductionContent('/workspace', refreshKey, readFile),
      { initialProps: { refreshKey: 0 } },
    );

    await act(async () => {
      first.resolve('# Old');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Old'));

    rerender({ refreshKey: 1 });

    await act(async () => {
      second.reject(new Error('temporary IPC failure'));
      await second.promise.catch(() => undefined);
    });

    expect(result.current).toBe('# Old');
  });

  it('clears the current content when the workspace reader resolves to missing', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ refreshKey }) => useIntroductionContent('/workspace', refreshKey, readFile),
      { initialProps: { refreshKey: 0 } },
    );

    await act(async () => {
      first.resolve('# Old');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Old'));

    rerender({ refreshKey: 1 });

    await act(async () => {
      second.resolve(null);
      await second.promise;
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('clears stale content only when switching workspaces', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ agentDir }) => useIntroductionContent(agentDir, 0, readFile),
      { initialProps: { agentDir: '/workspace-a' } },
    );

    await act(async () => {
      first.resolve('# Workspace A');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Workspace A'));

    rerender({ agentDir: '/workspace-b' });

    await waitFor(() => expect(result.current).toBeNull());
    expect(readFile).toHaveBeenLastCalledWith('INTRODUCTION.md');

    await act(async () => {
      second.resolve('# Workspace B');
      await second.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Workspace B'));
  });

  it('ignores stale reads from a previous workspace', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    readFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ agentDir }) => useIntroductionContent(agentDir, 0, readFile),
      { initialProps: { agentDir: '/workspace-a' } },
    );

    rerender({ agentDir: '/workspace-b' });

    await act(async () => {
      first.resolve('# Stale');
      await first.promise;
    });
    expect(result.current).toBeNull();

    await act(async () => {
      second.resolve('# Current');
      await second.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Current'));
  });

  it('keeps content for equivalent workspace path identities', async () => {
    const first = deferred<string | null>();
    readFile.mockReturnValueOnce(first.promise);

    const { result, rerender } = renderHook(
      ({ agentDir }) => useIntroductionContent(agentDir, 0, readFile),
      { initialProps: { agentDir: 'C:\\Users\\me\\project\\' } },
    );

    await act(async () => {
      first.resolve('# Windows');
      await first.promise;
    });
    await waitFor(() => expect(result.current).toBe('# Windows'));

    rerender({ agentDir: 'C:/Users/me/project' });

    expect(result.current).toBe('# Windows');
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});

describe('isIntroductionAbsentError', () => {
  it.each([
    new Error('File not found'),
    new Error('Not a regular file'),
    new Error('File type not supported'),
    new Error('File too large to preview (max 2 MB)'),
    new Error('File is not valid UTF-8: invalid utf-8 sequence'),
    'File not found',
  ])('maps expected preview absence errors to null content', (error) => {
    expect(isIntroductionAbsentError(error)).toBe(true);
  });

  it('does not swallow transient read failures', () => {
    expect(isIntroductionAbsentError(new Error('temporary IPC failure'))).toBe(false);
  });
});

describe('shouldShowIntroductionOverlay', () => {
  const base = {
    content: '# Welcome',
    historyMessageCount: 0,
    hasStreamingMessage: false,
    isSessionLoading: false,
    isLoading: false,
    sessionState: 'idle',
    showStartupOverlay: false,
  };

  it('shows introduction content only for a fully idle empty session', () => {
    expect(shouldShowIntroductionOverlay(base)).toBe(true);
  });

  it.each([
    ['missing content', { content: null }],
    ['existing history', { historyMessageCount: 1 }],
    ['streaming assistant message', { hasStreamingMessage: true }],
    ['session restore loading', { isSessionLoading: true }],
    ['turn loading', { isLoading: true }],
    ['starting session', { sessionState: 'starting' }],
    ['running session', { sessionState: 'running' }],
    ['startup overlay still visible', { showStartupOverlay: true }],
  ])('hides while %s', (_name, patch) => {
    expect(shouldShowIntroductionOverlay({ ...base, ...patch })).toBe(false);
  });
});

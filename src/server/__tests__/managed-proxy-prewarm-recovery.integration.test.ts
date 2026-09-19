import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../utils/managed-proxy-binding', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/managed-proxy-binding')>(),
  prepareProviderBinding: vi.fn(async () => { throw new Error('组件正在等待安全切换'); }),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: vi.fn(() => { throw new Error('SDK must not start before binding'); }),
}));

const scratch = mkdtempSync(join(tmpdir(), 'managed-proxy-recovery-'));
vi.stubEnv('HOME', scratch);
vi.stubEnv('USERPROFILE', scratch);

afterEach(async () => {
  const { clearPreWarmTimer } = await import('../builtin-session/lifecycle');
  clearPreWarmTimer();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it('settles queued input after exhausted binding retries instead of resetting the retry budget', async () => {
  const { initializeAgent, setMcpServers } = await import('../agent-session');
  const { pushMessage, getMessageQueue } = await import('../builtin-session/queue');
  const { prepareProviderBinding } = await import('../utils/managed-proxy-binding');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const { getPreWarmFailCount, getPreWarmTimer } = await import('../builtin-session/lifecycle');
  vi.useFakeTimers();
  await initializeAgent(scratch);
  setMcpServers([]);
  const resolve = vi.fn();
  pushMessage({
    id: 'queued-before-binding', messageText: 'hello', message: { role: 'user', content: 'hello' }, channelDelivery: { user: 'none', assistant: 'none' },
    resolve, wasQueued: true, attachments: [],
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(prepareProviderBinding).toHaveBeenCalledTimes(3);
  expect(getPreWarmFailCount()).toBe(3);
  expect(getMessageQueue()).toHaveLength(0);
  expect(resolve).toHaveBeenCalledOnce();
  expect(getPreWarmTimer()).toBeNull();
  expect(query).not.toHaveBeenCalled();
});

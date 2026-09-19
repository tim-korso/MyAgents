import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), data: vi.fn(), fetch: vi.fn() }));
vi.mock('../SessionStore', () => ({ getSessionMetadata: mocks.metadata, getSessionData: mocks.data }));
vi.mock('../utils/cancellation', () => ({ cancellableFetch: mocks.fetch }));
import { handleAdminSessionWatch } from './watch-handler';

beforeEach(() => {
  vi.stubEnv('MYAGENTS_MANAGEMENT_PORT', '31500');
  mocks.metadata.mockReset().mockImplementation(id => id === 'caller' ? { id, agentDir: '/synthetic' } : null);
  mocks.data.mockReset().mockResolvedValue(null);
  mocks.fetch.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('cross-process Session watch existence', () => {
  it('watches an accepted live target whose V2 metadata is unpublished in the caller process', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      watchId: 'watch', targetSessionId: 'target', targetStateAtRegistration: 'running', delivery: 'registered',
    } })));
    expect(await handleAdminSessionWatch('caller', { targetSessionId: 'target' })).toMatchObject({
      status: 200, response: { watched: true, delivery: 'registered' },
    });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ watcherSessionId: 'caller', targetSessionId: 'target' });
  });

  it('keeps a truly missing target a 404 after the lifecycle owner checks it', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      watchId: 'watch', targetSessionId: 'deleted', targetStateAtRegistration: 'idle', delivery: 'not_found',
    } })));
    expect(await handleAdminSessionWatch('caller', { targetSessionId: 'deleted' })).toMatchObject({
      status: 404, response: { watched: false, error: { code: 'session_not_found' } },
    });
  });
});

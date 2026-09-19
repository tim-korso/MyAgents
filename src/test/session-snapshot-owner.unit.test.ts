import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), sessionSidecarFetch: vi.fn() }));
vi.mock('../renderer/api/apiFetch', () => ({ apiFetch: mocks.apiFetch, apiGetJson: vi.fn(), apiPostJson: vi.fn() }));
vi.mock('../renderer/api/tauriClient', () => ({
  sessionSidecarFetch: mocks.sessionSidecarFetch,
  ensureSessionSidecar: vi.fn(), releaseSessionSidecar: vi.fn(), upgradeSessionId: vi.fn(),
}));
import { updateSession } from '../renderer/api/sessionClient';
import { composeSidecarRequestHandler, resolveSidecarComposition } from '../server/sidecar-composition';

describe('live Session snapshot owner routing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(['tab', 'companion'] as const)('publishes %s snapshot edits through the existing Session owner', async type => {
    const session = { id: 'session-1', permissionMode: 'suggest' };
    const handler = vi.fn(async () => Response.json({ success: true, session }));
    const dispatch = composeSidecarRequestHandler(resolveSidecarComposition('session', false), handler);
    mocks.sessionSidecarFetch.mockImplementation((_id, _owner, path, options) => dispatch(new Request(`http://local${path}`, options)));
    mocks.apiFetch.mockResolvedValue(Response.json({ success: true, session }));
    const owner = { type, id: 'owner-1' };
    await expect(updateSession('session-1', { permissionMode: 'suggest' }, owner)).resolves.toEqual(session);
    expect(mocks.sessionSidecarFetch).toHaveBeenCalledWith('session-1', owner, '/sessions/session-1', expect.objectContaining({ method: 'PATCH' }));
    expect(handler).toHaveBeenCalledOnce();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('does not retry a failed owner edit through Global', async () => {
    mocks.sessionSidecarFetch.mockRejectedValue(new Error('Session owner no longer exists'));
    mocks.apiFetch.mockResolvedValue(Response.json({ success: true, session: { id: 'session-1' } }));
    await expect(updateSession('session-1', { permissionMode: 'suggest' }, { type: 'tab', id: 'owner-1' })).rejects.toThrow('Session owner no longer exists');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('keeps unopened-session organizational edits on the Global metadata path', async () => {
    mocks.apiFetch.mockResolvedValue(Response.json({ success: true, session: { id: 'closed-session', title: 'Renamed' } }));
    await expect(updateSession('closed-session', { title: 'Renamed' })).resolves.toMatchObject({ title: 'Renamed' });
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    expect(mocks.sessionSidecarFetch).not.toHaveBeenCalled();
  });
});

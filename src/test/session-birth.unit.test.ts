import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cross-boundary wiring lives outside either production runtime tree. Mock
// only desktop transport; requests still pass through the real server role gate.
const mocks = vi.hoisted(() => ({
    apiPostJson: vi.fn(),
    ensureSessionSidecar: vi.fn(),
    releaseSessionSidecar: vi.fn(),
    sessionSidecarFetch: vi.fn(),
    upgradeSessionId: vi.fn(),
}));

vi.mock('../renderer/api/apiFetch', () => ({
    apiFetch: vi.fn(),
    apiGetJson: vi.fn(),
    apiPostJson: mocks.apiPostJson,
}));

vi.mock('../renderer/api/tauriClient', () => ({
    ensureSessionSidecar: mocks.ensureSessionSidecar,
    releaseSessionSidecar: mocks.releaseSessionSidecar,
    sessionSidecarFetch: mocks.sessionSidecarFetch,
    upgradeSessionId: mocks.upgradeSessionId,
}));

import { createSession } from '../renderer/api/sessionClient';
import { composeSidecarRequestHandler, resolveSidecarComposition } from '../server/sidecar-composition';

describe('createSession production owner routing', () => {
    const metadata = {
        id: 'born-session', agentDir: '/tmp/qa-workspace', title: 'New Chat',
        createdAt: '2026-09-13T00:00:00.000Z', lastActiveAt: '2026-09-13T00:00:00.000Z',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureSessionSidecar.mockResolvedValue({ isNew: true });
        mocks.upgradeSessionId.mockResolvedValue(true);
        mocks.releaseSessionSidecar.mockResolvedValue(true);
    });

    it.each([
        ['tab', 'codex'],
        ['companion', 'builtin'],
    ] as const)('births %s / %s through the production Session gate', async (type, runtime) => {
        const handler = vi.fn(async (request: Request) => {
            const body = await request.json();
            return Response.json(body.phase === 'commit'
                ? { success: true, sessionId: metadata.id, metadata }
                : { success: true, session: metadata });
        });
        const dispatch = composeSidecarRequestHandler(resolveSidecarComposition('session', false), handler);
        mocks.sessionSidecarFetch.mockImplementation((_id, _owner, path, options) =>
            dispatch(new Request(`http://127.0.0.1:31415${path}`, options)));
        const owner = { type, id: 'owner-1', pendingSessionId: 'pending-owner-1' };

        await expect(createSession(metadata.agentDir, runtime, undefined, owner)).resolves.toEqual(metadata);

        expect(mocks.sessionSidecarFetch).toHaveBeenNthCalledWith(1,
            owner.pendingSessionId, owner, '/api/session/birth', expect.any(Object));
        expect(mocks.sessionSidecarFetch).toHaveBeenNthCalledWith(2,
            metadata.id, owner, '/api/session/materialize', expect.objectContaining({
                body: JSON.stringify({ workspacePath: metadata.agentDir, phase: 'commit', preparedSessionId: metadata.id }),
            }));
        expect(mocks.upgradeSessionId).toHaveBeenCalledExactlyOnceWith(owner.pendingSessionId, metadata.id, owner.id, type);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(mocks.releaseSessionSidecar).not.toHaveBeenCalled();
        expect(mocks.apiPostJson).not.toHaveBeenCalled();
    });

    it('keeps unopened targets on the Global creation route', async () => {
        mocks.apiPostJson.mockResolvedValue({ success: true, session: metadata });
        await expect(createSession(metadata.agentDir, 'builtin')).resolves.toEqual(metadata);
        expect(mocks.apiPostJson).toHaveBeenCalledWith('/sessions', { agentDir: metadata.agentDir, runtime: 'builtin' });
        expect(mocks.ensureSessionSidecar).not.toHaveBeenCalled();
    });

    it('reports a non-JSON HTTP failure and releases the pending owner', async () => {
        mocks.sessionSidecarFetch.mockResolvedValue(new Response('Not Found', { status: 404 }));
        const owner = { type: 'tab' as const, id: 'owner-1', pendingSessionId: 'pending-owner-1' };
        await expect(createSession(metadata.agentDir, 'codex', undefined, owner))
            .rejects.toThrow('Session creation failed (HTTP 404).');
        expect(mocks.releaseSessionSidecar).toHaveBeenCalledExactlyOnceWith(owner.pendingSessionId, owner.type, owner.id);
        expect(mocks.upgradeSessionId).not.toHaveBeenCalled();
    });
});

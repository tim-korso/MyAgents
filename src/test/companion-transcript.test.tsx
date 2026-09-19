import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/Toast';
import type { SseEventHandler } from '@/api/SseConnection';
import type { TranscriptOperation, TranscriptSaveStatus } from '../shared/sessionTranscript';
import { useFloatingSession } from '@/floating-ball/useFloatingSession';
import { transcriptMessageOperations } from '../server/session-transcript/operations';

const harness = vi.hoisted(() => ({
    handler: null as SseEventHandler | null,
    generation: 1,
    revision: 0,
    format: 2 as 2 | undefined,
    rows: [] as unknown[],
    request: vi.fn(),
    create: vi.fn(),
    warning: undefined as TranscriptSaveStatus | undefined,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@/analytics', () => ({ initAnalytics: vi.fn(), setAnalyticsContext: vi.fn(), track: vi.fn() }));
vi.mock('../shared/logTime', () => ({ localDate: () => '2026-09-12' }));
vi.mock('@/config/services/appConfigService', () => ({
    loadAppConfig: async () => ({ floatingBallSessionId: 'companion', floatingBallSessionDate: '2026-09-12',
        floatingBallSessionWorkspace: '/synthetic', defaultWorkspacePath: '/synthetic' }),
    atomicModifyConfig: vi.fn(),
}));
vi.mock('@/config/services/projectService', () => ({ loadProjects: async () => [{ path: '/synthetic', name: 'Synthetic' }] }));
vi.mock('@/config/services/mcpService', () => ({ getAllMcpServersFromConfig: () => [] }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: vi.fn(async () => ({ unlisten: vi.fn() })) }));
vi.mock('@/api/sessionClient', () => ({ createSession: (...args: unknown[]) => harness.create(...args) }));
vi.mock('@/api/tauriClient', () => ({
    ensureSessionSidecar: async () => ({ port: 1234, isNew: false }),
    getSessionPort: async () => 1234,
    sessionSidecarFetch: (...args: unknown[]) => harness.request(...args),
    releaseSessionSidecar: vi.fn(async () => true), startBackgroundCompletion: vi.fn(),
}));
vi.mock('@/api/SseConnection', () => ({ createSseConnection: () => ({
    setEventHandler: (handler: SseEventHandler) => { harness.handler = handler; },
    setStatusHandler: vi.fn(), getConnectionGeneration: () => harness.generation,
    connect: async () => { harness.handler?.('chat:init', { sessionId: 'companion', transcriptFormat: harness.format,
        transcriptSaveStatus: harness.warning, sessionState: 'idle' }, { connectionGeneration: harness.generation }); },
    disconnect: vi.fn(async () => undefined),
}) }));

let current: ReturnType<typeof useFloatingSession>;
function Probe() {
    const mode = useRef<'hidden' | 'peek' | 'pin'>('pin');
    const session = useFloatingSession(mode);
    useLayoutEffect(() => { current = session; }, [session]);
    return <><input aria-label="Draft" defaultValue="next question" />
        <button onClick={() => void session.send('next question')}>Send</button>
        <div data-testid="rows">{JSON.stringify([...session.messages, ...(session.liveMessage ? [session.liveMessage] : [])])}</div>
    </>;
}
function rows(): Array<{ id: string; role: string; text?: string; content?: Array<Record<string, unknown>> }> {
    return JSON.parse(screen.getByTestId('rows').textContent!);
}
function emit(event: string, data: unknown, revision = ++harness.revision) {
    act(() => harness.handler!(event, data, { sessionId: 'companion', connectionGeneration: harness.generation, liveRevision: revision }));
}
function operation(op: TranscriptOperation) {
    emit('chat:transcript-operation', { sessionId: 'companion', operation: op });
}
function snapshot() {
    return { success: true, session: { id: 'companion', transcriptFormat: harness.format, messages: harness.rows,
        snapshotRevision: harness.revision, liveSessionState: 'idle', transcriptSaveStatus: harness.warning } };
}
async function mount() {
    render(<ToastProvider><Probe /></ToastProvider>);
    await waitFor(() => expect(current.ready).toBe(true));
}

beforeEach(() => {
    harness.handler = null; harness.generation = 1; harness.revision = 0; harness.format = 2;
    harness.rows = []; harness.warning = undefined; harness.create.mockReset(); harness.request.mockReset();
    harness.request.mockImplementation(async (_id: string, _owner: unknown, path: string) =>
        new Response(JSON.stringify(path.startsWith('/sessions/') ? snapshot() : { success: true, agents: {} }),
            { headers: { 'Content-Type': 'application/json' } }));
});

describe('Companion product transcript integration', () => {
    it('continues a V1 Session using the legacy history and stream without creating another Session', async () => {
        harness.format = undefined;
        harness.rows = [{ id: 'old-user', role: 'user', content: 'old question' }];
        await mount();
        emit('chat:message-chunk', 'legacy answer'); emit('chat:message-complete', {});
        expect(rows().map(row => row.role)).toEqual(['user', 'ai']);
        expect(rows()[1].content?.[0].text).toBe('legacy answer');
        expect(harness.create).not.toHaveBeenCalled();
        expect(harness.request.mock.calls.some(call => call[2] === '/api/mcp/set' || call[2] === '/api/agents/set')).toBe(false);
    });

    it('uses V2 message identities through interleaving, corrections and late tool results', async () => {
        await mount();
        const timestamp = '2026-09-12T00:00:00Z';
        for (const op of transcriptMessageOperations({ id: 'u1', role: 'user', timestamp, content: 'first question' })) operation(op);
        operation({ kind: 'message-create', message: { id: 'a1', role: 'assistant', timestamp, transcriptState: 'streaming', content: [] } });
        operation({ kind: 'block-upsert', messageId: 'a1', block: { id: 'text1', type: 'text', text: 'first answer' } });
        operation({ kind: 'block-upsert', messageId: 'a1', block: { id: 'tool-block', type: 'tool_use', tool: { id: 'tool1', name: 'Read', input: {}, isLoading: true } } });
        emit('chat:message-chunk', 'first answer'); // Compatibility event must not duplicate V2 content.
        const followup = JSON.stringify([{ type: 'text', text: 'x'.repeat(40 * 1024) }]);
        for (const op of transcriptMessageOperations({ id: 'u2', role: 'user', timestamp, content: followup })) operation(op);
        operation({ kind: 'message-create', message: { id: 'a2', role: 'assistant', timestamp, transcriptState: 'streaming', content: [] } });
        operation({ kind: 'block-upsert', messageId: 'a2', block: { id: 'text2', type: 'text', text: 'second answer' } });
        operation({ kind: 'block-update', messageId: 'a1', blockId: 'text1', target: 'block', details: { text: 'corrected first answer' } });
        emit('chat:tool-result-complete', { toolUseId: 'tool1', content: 'late result', isError: false });
        expect(rows().map(row => row.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
        expect(rows()[0].text).toBe('first question');
        expect(rows()[2].text).toBe(followup);
        expect(rows()[1].content?.[0].text).toBe('corrected first answer');
        expect(rows()[1].content?.[1].tool).toMatchObject({ id: 'tool1', result: 'late result' });
        expect(rows()[3].content).toHaveLength(1);
        operation({ kind: 'messages-remove', messageIds: ['a2'] });
        expect(rows().map(row => row.id)).toEqual(['u1', 'a1', 'u2']);
    });

    it('shows a deduplicated save-fault toast without blocking send, clearing the draft or moving focus', async () => {
        await mount();
        const input = screen.getByLabelText('Draft'); input.focus();
        const fault: TranscriptSaveStatus = { sessionId: 'companion', instanceId: 'writer', generation: 'g1',
            state: 'retrying', incidentId: 'disk-fault', reason: 'io', liveRevision: 8, durableRevision: 2 };
        emit('chat:transcript-save-status', fault); emit('chat:transcript-save-status', fault);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('对话记录暂时无法保存');
        expect(input).toHaveFocus(); expect(input).toHaveValue('next question');
        fireEvent.click(screen.getByText('Send'));
        await waitFor(() => expect(harness.request.mock.calls.some(call => call[2] === '/chat/send')).toBe(true));
        expect(current.error).toBeNull();
        emit('chat:transcript-save-status', { ...fault, state: 'healthy', durableRevision: 8 });
        expect(screen.getByText('对话记录保存已恢复。')).toBeInTheDocument();
    });

    it('restores a reconnect snapshot and replays only later operations against the retained history', async () => {
        harness.rows = [{ id: 'a1', role: 'assistant', content: 'before disconnect' }];
        await mount();
        let resolve!: (response: Response) => void;
        harness.request.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
        harness.generation++;
        act(() => harness.handler!('chat:init', { sessionId: 'companion', transcriptFormat: 2 }, { connectionGeneration: harness.generation }));
        await waitFor(() => expect(resolve).toBeTypeOf('function'));
        harness.revision = 5;
        operation({ kind: 'content-confirm', messageId: 'a1', content: 'corrected during restore' });
        const timestamp = '2026-09-12T00:00:00Z';
        operation({ kind: 'message-create', message: { id: 'u2', role: 'user', timestamp, content: 'cross-surface follow-up' } });
        await act(async () => resolve(new Response(JSON.stringify({ success: true, session: {
            id: 'companion', transcriptFormat: 2, snapshotRevision: 5, liveSessionState: 'idle',
            messages: [{ id: 'a1', role: 'assistant', content: 'completed while disconnected' }],
        } }))));
        expect(rows().map(row => row.id)).toEqual(['a1', 'u2']);
        expect(rows()[0].content?.[0].text).toBe('corrected during restore');
        emit('chat:transcript-operation', { sessionId: 'companion', operation: {
            kind: 'content-confirm', messageId: 'a1', content: 'stale duplicate',
        } }, 6);
        expect(rows()[0].content?.[0].text).toBe('corrected during restore');
    });

    it('recovers a same-connection revision gap and preserves canonical background tool state at terminal', async () => {
        await mount();
        harness.rows = [{ id: 'a1', role: 'assistant', content: JSON.stringify([{ id: 'b1', type: 'tool_use',
            tool: { id: 'background', name: 'Task', input: {}, isLoading: true } }]) }];
        harness.revision = 4;
        emit('chat:status', { sessionState: 'idle' }, 4);
        await waitFor(() => expect(rows()[0]?.id).toBe('a1'));
        expect(rows()[0].content?.[0].tool).toMatchObject({ isLoading: true });
        harness.revision = 4;
        operation({ kind: 'message-create', message: { id: 'a2', role: 'assistant', timestamp: '2026-09-12T00:00:00Z', content: [] } });
        operation({ kind: 'block-upsert', messageId: 'a2', block: { id: 'b2', type: 'tool_use', tool: {
            id: 'background2', name: 'Task', input: {}, isLoading: true,
        } } });
        emit('chat:message-complete', {});
        expect(rows()[1].content?.[0].tool).toMatchObject({ isLoading: true });
    });
});

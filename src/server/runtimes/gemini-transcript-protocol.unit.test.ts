import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedEvent } from './types';

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('../utils/subprocess', () => ({ spawn: boundary.spawn }));
vi.mock('../sse', () => ({ broadcast: vi.fn() }));
vi.mock('./env-utils', () => ({ augmentedProcessEnv: () => ({}), resolveCommand: () => 'synthetic-gemini', stripAnsi: (value: string) => value }));
// No model requests or product/user-directory IO: exercise the real ACP reader
// and Runtime normalization through the subprocess boundary.
vi.mock('fs', async original => ({ ...await original<typeof import('fs')>(), existsSync: () => true, readdirSync: () => [] }));
import { GeminiRuntime } from './gemini';

function acpProcess() {
  const encoder = new TextEncoder();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (code: number) => void;
  let closed = false;
  let turn = 0;
  const requests: string[] = [];
  const send = (value: unknown) => output.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
  const update = (value: unknown) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'native', update: value } });
  const proc = {
    pid: 4242,
    stdout: new ReadableStream<Uint8Array>({ start(controller) { output = controller; } }),
    stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    exited: new Promise<number>(resolve => { exit = resolve; }),
    stdin: { underlying: undefined as never, async end() {}, async write(bytes: Uint8Array) {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as { id: number; method: string };
      requests.push(request.method);
      queueMicrotask(() => {
        let result: unknown = {};
        if (request.method === 'session/new') result = { sessionId: 'native' };
        if (request.method === 'session/load') {
          update({ sessionUpdate: 'agent_message_chunk', content: { text: 'old replay' } });
          update({ sessionUpdate: 'tool_call', toolCallId: 'old-tool', title: 'Read', kind: 'read' });
        }
        if (request.method === 'session/prompt') {
          turn++;
          if (turn === 2) {
            send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'synthetic native failure' } });
            return;
          }
          update({ sessionUpdate: 'agent_thought_chunk', content: { text: 'thinking' } });
          update({ sessionUpdate: 'agent_message_chunk', content: { text: 'answer' } });
          update({ sessionUpdate: 'tool_call', toolCallId: 'read_file-1', title: 'Read', kind: 'read', locations: [{ path: '/synthetic' }] });
          update({ sessionUpdate: 'tool_call_update', toolCallId: 'read_file-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'file result' } }] });
          result = { stopReason: 'end_turn' };
        }
        send({ jsonrpc: '2.0', id: request.id, result });
      });
    } },
    kill() { if (!closed) { closed = true; output.close(); exit(0); } return true; },
  };
  return { proc, requests };
}

afterEach(() => vi.restoreAllMocks());

describe('Gemini native ACP transcript boundary', () => {
  it.each([false, true])('normalizes live content/tools and terminal failure without duplicating loaded history (resume=%s)', async resume => {
    const fake = acpProcess();
    boundary.spawn.mockReturnValue(fake.proc);
    const runtime = new GeminiRuntime();
    vi.spyOn(runtime, 'detect').mockResolvedValue({ installed: true, version: 'synthetic' });
    const events: UnifiedEvent[] = [];
    try {
      const process = await runtime.startSession({ sessionId: 'product', workspacePath: '/synthetic', scenario: { type: 'desktop' },
        ...(resume ? { resumeSessionId: 'native' } : {}) }, event => { events.push(event); });
      expect(events.filter(event => event.kind === 'text_delta' || event.kind === 'tool_use_start')).toEqual([]);
      await runtime.sendMessage(process, 'first');
      await vi.waitFor(() => expect(events.some(event => event.kind === 'turn_complete')).toBe(true));
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'text_delta', text: 'answer' }),
        expect.objectContaining({ kind: 'tool_use_start', toolUseId: 'read_file-1' }),
        expect.objectContaining({ kind: 'tool_result', toolUseId: 'read_file-1', content: 'file result', isError: false }),
      ]));
      expect(JSON.stringify(events)).not.toContain('old replay');
      expect(events.filter(event => event.kind === 'thinking_start')).toHaveLength(1);
      expect(events.filter(event => event.kind === 'thinking_stop')).toHaveLength(1);
      await runtime.sendMessage(process, 'next');
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ kind: 'session_complete', subtype: 'error', result: expect.stringContaining('synthetic native failure') })));
      expect(fake.requests.filter(method => method === (resume ? 'session/load' : 'session/new'))).toHaveLength(1);
    } finally { fake.proc.kill(); }
  });
});

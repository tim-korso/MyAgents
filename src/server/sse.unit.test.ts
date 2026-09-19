import { afterEach, describe, expect, it, vi } from 'vitest';

import { broadcast, broadcastLive, summarizeSsePayload } from './sse';

describe('SSE streaming projection log policy', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    'chat:transcript-operation',
    'chat:transcript-save-status',
    'chat:mcp-effective-snapshot',
    'chat:runtime-tool-catalog',
    'chat:context-usage',
    'chat:agent-plan-update',
    'chat:runtime-diagnostics',
  ])('keeps repeated %s silent with and without a live revision envelope', event => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let revision = 0;
    const scope = { sessionId: 'synthetic-session', nextRevision: () => ++revision };
    for (let i = 0; i < 100; i++) {
      const data = { operation: { kind: 'text-append', text: 'private stream', offset: i }, state: 'healthy' };
      broadcast(event, data);
      broadcastLive(event, data, scope);
    }
    expect(log).not.toHaveBeenCalled();

    broadcast('chat:message-complete', { output_tokens: 100 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('[sse] chat:message-complete ->');
  });
});

describe('SSE replay diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['live-user-echo', 'session-b'],
    ['cold-history', undefined],
  ])('logs %s replay scope presence without identifiers or content', (replayKind, sessionId) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    broadcast('chat:message-replay', {
      replayKind,
      sessionId,
      message: {
        id: '0',
        role: 'user',
        content: 'private message body',
      },
    });

    expect(log).toHaveBeenCalledWith(
      `[sse] chat:message-replay -> messageId=0 replayKind=${replayKind} role=user sessionScope=${sessionId ? 'present' : 'none'}`,
    );
    expect(log.mock.calls.flat().join(' ')).not.toContain('private message body');
    expect(log.mock.calls.flat().join(' ')).not.toContain('session-b');
  });

  it('summarizes generic transport payloads without retaining body, password, command, or path prefixes', () => {
    const markers = {
      body: 'SSE_PRIVATE_BODY_MARKER',
      password: 'SSE_PASSWORD_MARKER',
      inputPath: '/Users/private/SSE_INPUT_PATH_MARKER.pdf',
      outputPath: '/Users/private/SSE_OUTPUT_PATH_MARKER',
    };
    const summary = summarizeSsePayload('chat:tool-result-complete', {
      isError: true,
      content: markers.body,
      input: {
        command: `myagents anydoc convert --password ${markers.password}`,
        source: markers.inputPath,
        output: markers.outputPath,
      },
    });

    expect(summary).toMatch(/^payload=\{"present":true,"chars":\d+,"hash":"[a-f0-9]{12}"\} isError=true$/);
    for (const marker of Object.values(markers)) {
      expect(summary).not.toContain(marker);
    }
    expect(summary).not.toContain('myagents anydoc convert');
  });

  it('summarizes arbitrary string payloads irreversibly', () => {
    const summary = summarizeSsePayload('chat:message-error', 'SSE_RAW_ERROR_MARKER at /private/path');

    expect(summary).toMatch(/^payload=\{"present":true,"chars":\d+,"hash":"[a-f0-9]{12}"\}$/);
    expect(summary).not.toContain('SSE_RAW_ERROR_MARKER');
    expect(summary).not.toContain('/private/path');
  });
});

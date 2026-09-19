import { EventEmitter } from 'node:events';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Browser, BrowserContext, BrowserType } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { PlaywrightBrowserHost } from './browser-host';
import { BrowserContextRegistry, type BrowserContextRegistryDependencies } from './context-registry';

const AUTHORITY = '127.0.0.1:31415';
const EMPTY_STATE = { cookies: [], origins: [] };

class SyntheticContext extends EventEmitter {
  closed = false;
  pages() { return []; }
  async cookies() { return []; }
  async addCookies() {}
  _setAllowedProtocols() {}
  _setAllowedDirectories() {}
  async close() { this.closed = true; this.emit('close'); }
}

function setup(overrides: Partial<BrowserContextRegistryDependencies> = {}) {
  const contexts: SyntheticContext[] = [];
  const browser = Object.assign(new EventEmitter(), {
    isConnected: () => true,
    newContext: async () => {
      const context = new SyntheticContext();
      contexts.push(context);
      return context as unknown as BrowserContext;
    },
    close: async () => {},
  }) as unknown as Browser;
  const checkpointIdentity = vi.fn(async (_id, _base, _observed, state) => ({
    revision: 2, state, conflictCount: 0,
  }));
  const registry = new BrowserContextRegistry({
    readIdentity: async () => ({ revision: 1, state: EMPTY_STATE }),
    checkpointIdentity,
    resolveResource: async () => ({ revision: 'synthetic', executablePath: '/synthetic/chromium' }),
    loadBrowserType: async () => ({ launch: async () => browser }) as unknown as BrowserType,
    ...overrides,
  });
  let owner = 'session-a';
  const host = new PlaywrightBrowserHost(31415, {
    registry,
    verifyCapability: async () => ({
      productSessionId: owner, workspacePath: '/workspace/browser-lifecycle', hostGeneration: 1,
    }),
  });
  function request(body: unknown, sessionId?: string, signal?: AbortSignal) {
    return host.handleRequest(new Request(`http://${AUTHORITY}/mcp/playwright`, {
      method: 'POST', signal,
      headers: {
        Authorization: `Bearer ${'a'.repeat(32)}`, Host: AUTHORITY,
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    }));
  }
  async function initialize() {
    const response = await request({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } },
    });
    return String(response.headers.get('mcp-session-id'));
  }
  const call = (id: number, name = 'browser_cookie_list') => ({
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} },
  });
  return { host, registry, contexts, checkpointIdentity, request, initialize, call, adopt: (id: string) => { owner = id; } };
}

describe('managed Browser with the installed MCP protocol and transport', () => {
  it('uses the adopted owner when the first tool follows provisional initialization', async () => {
    const h = setup();
    h.adopt('pending-a');
    const sessionId = await h.initialize();
    h.adopt('real-a');
    try {
      expect(await (await h.request(h.call(2), sessionId)).json()).not.toHaveProperty('result.isError', true);
      await h.request(h.call(3, 'browser_close'), sessionId);
      expect(h.contexts).toHaveLength(1);
      expect(h.contexts[0].closed).toBe(true);
      expect(h.checkpointIdentity).toHaveBeenCalledWith('real-a', expect.anything(), expect.anything(), EMPTY_STATE);
    } finally { await h.host.shutdown(); }
  });

  it.each(['notification', 'batched notification', 'abort', 'replacement', 'retirement', 'shutdown'] as const)(
    'drains actual resource acquisition on %s and releases the Host', async mode => {
      let resourceSignal: AbortSignal | undefined;
      const h = setup({ resolveResource: signal => {
        if (resourceSignal) return Promise.resolve({ revision: 'synthetic', executablePath: '/synthetic/chromium' });
        return new Promise((_resolve, reject) => {
          resourceSignal = signal;
          signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      } });
      const sessionId = await h.initialize();
      const controller = new AbortController();
      let settled = false;
      const pending = h.request(h.call(2), sessionId, controller.signal).then(response => {
        settled = true;
        return response;
      });
      await vi.waitFor(() => expect(resourceSignal).toBeDefined());
      let retiring: Promise<unknown> | undefined;
      if (mode === 'notification') {
        await h.request({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } }, sessionId);
        expect(resourceSignal!.aborted).toBe(false);
        await h.request({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }, sessionId);
      } else if (mode === 'batched notification') {
        await h.request([{ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }], sessionId);
      } else if (mode === 'abort') controller.abort();
      else if (mode === 'replacement') await h.initialize();
      else if (mode === 'retirement') retiring = h.host.retireProductSession('session-a');
      else retiring = h.host.shutdown();
      try {
        await vi.waitFor(() => expect(settled).toBe(true));
        expect(resourceSignal!.aborted).toBe(true);
        await pending;
        await retiring;
        if (mode === 'notification' || mode === 'batched notification' || mode === 'abort') {
          const retry = await (await h.request(h.call(4), sessionId)).json();
          expect(retry.result.isError).not.toBe(true);
          expect(h.contexts).toHaveLength(1);
        }
        await h.host.shutdown();
      } finally { void h.host.shutdown(); }
    },
  );

  it.each(['retirement', 'shutdown'] as const)(
    'fences acquisition when %s follows dispatch but precedes the lazy factory', async mode => {
      const resolveResource = vi.fn(async () => ({ revision: 'synthetic', executablePath: '/synthetic/chromium' }));
      const h = setup({ resolveResource });
      const sessionId = await h.initialize();
      const { transport } = (h.host as unknown as {
        connections: Map<string, { transport: WebStandardStreamableHTTPServerTransport }>;
      }).connections.get(sessionId)!;
      const onmessage = transport.onmessage;
      let retiring: Promise<void> | undefined;
      transport.onmessage = (message, extra) => {
        onmessage?.(message, extra);
        // Real Protocol dispatch defers the tool handler. Retire synchronously
        // here, before the Context factory can register a Registry waiter.
        if ('method' in message && message.method === 'tools/call') {
          retiring = mode === 'retirement' ? h.host.retireProductSession('session-a') : h.host.shutdown();
        }
      };
      try {
        const response = await (await h.request(h.call(2), sessionId)).json();
        await retiring;
        expect(response.result.isError).toBe(true);
        expect(resolveResource).not.toHaveBeenCalled();
        expect(h.contexts).toHaveLength(0);
      } finally { await h.host.shutdown(); }
    },
  );

  it('drains a cancelled established tool before retiring its live Context', async () => {
    const h = setup();
    const sessionId = await h.initialize();
    await h.request(h.call(2), sessionId);
    const gate = Promise.withResolvers<never[]>();
    const cookies = vi.spyOn(h.contexts[0], 'cookies').mockImplementationOnce(() => gate.promise);
    const active = h.request(h.call(3), sessionId);
    await vi.waitFor(() => expect(cookies).toHaveBeenCalled());
    await h.request({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }, sessionId);
    let retired = false;
    const retiring = h.host.retireProductSession('session-a').then(() => { retired = true; });
    expect(retired).toBe(false);
    expect(h.contexts[0].closed).toBe(false);
    gate.resolve([]);
    let settled = false;
    void active.then(() => { settled = true; });
    await vi.waitFor(() => expect(settled).toBe(true));
    await retiring;
    expect(h.contexts[0].closed).toBe(true);
    await h.host.shutdown();
  });

  it('preserves an HTTP abort that precedes lazy Context acquisition and permits retry', async () => {
    const h = setup();
    const sessionId = await h.initialize();
    const controller = new AbortController();
    controller.abort();
    const cancelled = await (await h.request(h.call(2), sessionId, controller.signal)).json();
    expect(cancelled.result.isError).toBe(true);
    expect(h.contexts).toHaveLength(0);
    const retry = await (await h.request(h.call(3), sessionId)).json();
    expect(retry.result.isError).not.toBe(true);
    expect(h.contexts).toHaveLength(1);
    await h.host.shutdown();
  });

  it('remembers cancellation in the same batch before the lazy factory registers acquisition', async () => {
    const resolveResource = vi.fn(async () => ({ revision: 'synthetic', executablePath: '/synthetic/chromium' }));
    const h = setup({ resolveResource });
    const sessionId = await h.initialize();
    try {
      const result = await (await h.request([
        h.call(2), { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } },
      ], sessionId)).json();
      const response = Array.isArray(result) ? result[0] : result;
      expect(response.result.isError).toBe(true);
      expect(resolveResource).not.toHaveBeenCalled();
      expect(h.contexts).toHaveLength(0);
      const retry = await (await h.request(h.call(3), sessionId)).json();
      expect(retry.result.isError).not.toBe(true);
      expect(h.contexts).toHaveLength(1);
    } finally { await h.host.shutdown(); }
  });

  it('keeps code/file tools but excludes the non-product installer from listing and direct/batched calls', async () => {
    const h = setup();
    const sessionId = await h.initialize();
    try {
      const catalog = await (await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId)).json();
      const names = catalog.result.tools.map((tool: { name: string }) => tool.name);
      // Assert removal before issuing the call, so running against the old code cannot install anything.
      expect(names).not.toContain('browser_install');
      expect(names).toEqual(expect.arrayContaining(['browser_run_code', 'browser_storage_state', 'browser_set_storage_state', 'browser_file_upload']));
      const direct = await (await h.request(h.call(3, 'browser_install'), sessionId)).json();
      expect(direct.result.isError).toBe(true);
      const batch = await (await h.request([
        h.call(4, 'browser_install'), { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      ], sessionId)).json();
      expect(batch.find((reply: { id: number }) => reply.id === 4).result.isError).toBe(true);
      expect(batch.find((reply: { id: number }) => reply.id === 5).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('browser_install');
      expect(h.contexts).toHaveLength(0);
    } finally { await h.host.shutdown(); }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProviderEnv } from '../provider-types';
import { assertManagedProviderPrepared } from '../utils/managed-proxy-binding';

const mocks = vi.hoisted(() => ({ api: vi.fn(), query: vi.fn(), failed: false }));
vi.mock('../utils/management-api-client', () => ({ managementApi: mocks.api }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('../agent-session', () => ({
  buildClaudeSessionEnv: (env: ProviderEnv) => { assertManagedProviderPrepared(env); return { ANTHROPIC_BASE_URL: env.baseUrl, ANTHROPIC_API_KEY: env.apiKey }; },
  resolveClaudeCodeCli: () => 'synthetic-sdk', startOneShotBridge: () => null,
}));
vi.mock('../utils/admin-config', () => ({
  loadConfig: () => ({}), getEffectiveOfficialToolIdsForSession: () => ['image-understanding'],
  findEffectiveProvider: () => ({ id: 'antigravity-sub', type: 'subscription' }), getAllEffectiveProviders: () => [],
  resolveProviderEnv: () => ({ providerId: 'antigravity-sub', apiProtocol: 'anthropic', endpointSource: { kind: 'cliproxy', providerId: 'antigravity-sub' } }),
  resolveImageUnderstandingToolAvailability: () => ({ ok: true, providerId: 'antigravity-sub', model: 'approved-image' }),
}));
vi.mock('../utils/imageResize', () => ({ processImage: async (image: unknown) => [image] }));
import { analyzeImages } from './vision';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([false, true])('binds managed vision and trusts its actual terminal (failed=%s)', async failed => {
  const scratch = mkdtempSync(join(tmpdir(), 'myagents-cliproxy-vision-'));
  vi.stubEnv('MYAGENTS_SIDECAR_ID', 'vision-owner');
  const grant = { providerId: 'antigravity-sub', baseUrl: 'http://127.0.0.1:13491', apiKey: 'a'.repeat(64),
    instanceGeneration: randomUUID(), accountGeneration: randomUUID(), leaseId: randomUUID(), modelPolicy: { id: 'approved-image', thinking: false } };
  mocks.api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grant } : { ok: true });
  const close = vi.fn();
  mocks.query.mockReturnValue({ close, async *[Symbol.asyncIterator]() {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial vision text' }] } };
    yield { type: 'result', subtype: failed ? 'error_during_execution' : 'success' };
  } });
  writeFileSync(join(scratch, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  try {
    const result = analyzeImages({ workspacePath: scratch, sessionMeta: { id: 'vision-owner', agentDir: scratch,
      title: 'Test', createdAt: '', lastActiveAt: '', enabledOfficialToolIds: ['image-understanding'] }, images: ['image.png'] });
    if (failed) await expect(result).rejects.toThrow('did not complete');
    else expect((await result).text).toBe('partial vision text');
    expect(mocks.api.mock.calls[0][0]).toBe('/api/cliproxy/binding/acquire');
    expect(mocks.query.mock.calls[0][0].options.env).toMatchObject({ ANTHROPIC_BASE_URL: grant.baseUrl, ANTHROPIC_API_KEY: grant.apiKey });
    expect(mocks.query.mock.calls[0][0].options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code', append: expect.stringContaining('image') });
    expect(mocks.query.mock.calls[0][0].options.tools).toEqual([]);
    expect(mocks.api.mock.calls.some(([, , body]) => body.terminal === (failed ? 'failed' : 'succeeded') && body.leaseId === grant.leaseId)).toBe(true);
    expect(mocks.api.mock.calls.at(-1)?.[0]).toBe('/api/cliproxy/binding/release');
    expect(close).toHaveBeenCalled();
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

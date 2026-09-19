import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProviderEnv } from './provider-types';

const mocks = vi.hoisted(() => ({ api: vi.fn(), query: vi.fn() }));
vi.mock('./utils/management-api-client', () => ({ managementApi: mocks.api }));
vi.mock('./utils/fs-utils', () => ({ ensureDirSync: vi.fn() }));
vi.mock('./utils/sdk-child-launch-guard', () => ({ createGuardedSdkQuery: (_path: string, create: () => unknown) => create() }));
vi.mock('./agent-session', () => ({ resolveClaudeCodeCli: () => 'unused-sdk', getSidecarPort: () => 0,
  buildClaudeSessionEnv: () => ({}), startOneShotBridge: () => null }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query,
  createSdkMcpServer: (config: unknown) => config,
  tool: (_name: string, _description: string, _schema: unknown, handler: () => unknown) => ({ handler }),
}));
import { generateTitle } from './title-generator';

const provider: ProviderEnv = { providerId: 'antigravity-sub', apiProtocol: 'anthropic',
  endpointSource: { kind: 'cliproxy', providerId: 'antigravity-sub' } };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
function bind() {
  vi.stubEnv('MYAGENTS_SIDECAR_ID', 'prompt-test');
  const grant = { providerId: 'antigravity-sub', baseUrl: 'http://127.0.0.1:13491', apiKey: 'a'.repeat(64),
    instanceGeneration: randomUUID(), accountGeneration: randomUUID(), leaseId: randomUUID(),
    modelPolicy: { id: 'approved-model', thinking: false } };
  mocks.api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grant } : { ok: true });
  return grant;
}

it.each([true, false])('preserves title instructions and tool isolation (managed=%s)', async managed => {
  if (managed) bind();
  mocks.query.mockReturnValue({ close: vi.fn(), async *[Symbol.asyncIterator]() {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Example title' }] } };
    yield { type: 'result', subtype: 'success' };
  } });
  expect(await generateTitle([{ user: 'Plan the trip', assistant: 'Here is a plan.' }], 'approved-model', managed ? provider : undefined)).toBe('Example title');
  const options = mocks.query.mock.calls[0][0].options;
  if (managed) {
    expect(options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code', append: expect.any(String) });
    expect(options.systemPrompt.append).toContain('title');
  } else expect(typeof options.systemPrompt).toBe('string');
  expect(options.tools).toEqual([]);
  expect(options.mcpServers).toEqual({});
  expect(options.strictMcpConfig).toBe(true);
});

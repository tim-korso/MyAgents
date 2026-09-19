import { describe, expect, it } from 'vitest';
import { resolveAgentConfigMutation } from './agentConfigMutation';
import type { AgentConfig } from './types/agent';

const agent: AgentConfig = { id: 'a', name: 'test', enabled: false, permissionMode: 'auto', runtime: 'codex', channels: [], runtimeConfig: { model: 'model-b', permissionMode: 'full-auto', envPolicy: { proxy: 'terminal' } } };

describe('Agent execution edits at the config writer', () => {
  it('changes only the requested field against latest state', () => {
    const patch = resolveAgentConfigMutation(agent, { runtimeConfigPatch: { reasoningEffort: 'high' } });
    expect(patch).toEqual({ runtimeConfig: { ...agent.runtimeConfig, reasoningEffort: 'high' } });
    expect(patch).not.toHaveProperty('runtimeConfigPatch');
  });
  it('scrubs runtime-specific values while retaining current environment policy', () => {
    const patch = resolveAgentConfigMutation(agent, { runtime: 'gemini' });
    expect(patch.runtime).toBe('gemini');
    expect(patch.runtimeConfig).toEqual({ envPolicy: { proxy: 'terminal' } });
  });
  it('keeps explicit full replacements distinct from field patches', () => {
    expect(resolveAgentConfigMutation(agent, { runtimeConfig: {} })).toEqual({ runtimeConfig: {} });
  });
  it('resolves managed provider selection using the latest environment and product permission', () => {
    const patch = resolveAgentConfigMutation(agent, {
      runtimeBackedProviderSelection: { kind: 'runtime-backed-provider', providerId: 'codex-sub', model: 'model-c', runtime: 'codex', runtimeSource: 'managed-provider' },
      permissionMode: 'fullAgency',
    });
    expect(patch).toMatchObject({ providerId: 'codex-sub', runtime: 'builtin', permissionMode: 'fullAgency', model: 'model-c', runtimeConfig: { envPolicy: { proxy: 'terminal' } } });
    expect(patch.runtimeConfig).not.toHaveProperty('model');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { reasoningEffortAfterModelChange } from '../../shared/reasoningEffort';
import { persistInputOptionChange } from '../api/persistInputOption';

import { CODEX_SUBSCRIPTION_PROVIDER_ID } from '@/config/types';
import { createConcreteProviderRoute } from '../../shared/providerRoute';
import { IMAGE_UNDERSTANDING_TOOL_ID } from '../../shared/official-tools';
import type { ProviderExecutionIntent } from '../../shared/providerExecution';
import {
  buildProviderSwitchSessionBirth,
  buildRuntimeBackedInitialSessionBirth,
} from './providerSwitchSessionBirth';

describe('buildProviderSwitchSessionBirth', () => {
  it('carries managed Codex as session-scoped runtime-backed provider metadata', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'runtime-backed-provider',
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      runtime: 'codex',
      runtimeSource: 'managed-provider',
      model: 'gpt-5.5-codex',
    };

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      model: 'ignored-by-runtime-backed-intent',
      permissionMode: 'auto',
      reasoningEffort: 'max',
      mcpEnabledServers: ['filesystem'],
      enabledPluginIds: ['plugin-a'],
    })).toEqual({
      runtime: 'codex',
      opts: {
        runtimeSource: 'managed-provider',
        providerExecutionIdentity: targetIntent,
        providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
        model: 'gpt-5.5-codex',
        permissionMode: 'auto-edit',
        reasoningEffort: 'max',
        mcpEnabledServers: ['filesystem'],
        enabledPluginIds: ['plugin-a'],
      },
    });
  });

  it('shares the normalized target effort between a confirmed managed birth and Agent defaults', async () => {
    const identity = { kind: 'runtime-backed-provider' as const, providerId: 'codex-sub' as const, runtime: 'codex' as const, runtimeSource: 'managed-provider' as const, model: 'target' };
    const effort = reasoningEffortAfterModelChange('max', { defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] });
    const birth = buildRuntimeBackedInitialSessionBirth({ identity, reasoningEffort: effort });
    const patchAgentConfig = vi.fn().mockResolvedValue(undefined);
    await persistInputOptionChange({ workspaceId: 'ws', agentId: 'agent', isExternalRuntime: false, fields: { runtimeBackedProviderSelection: identity, reasoningEffort: effort }, patchProject: vi.fn(), patchAgentConfig, patchAgentProjectConfig: async (id, patch) => { await patchAgentConfig(id, patch); } });
    expect(effort).toBe('default');
    expect(birth.opts.reasoningEffort).toBe('default');
    expect(patchAgentConfig).toHaveBeenCalledWith('agent', expect.objectContaining({ reasoningEffort: 'default' }));
  });

  it('creates builtin provider sessions without requiring a workspace template write', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'builtin-provider',
      route: createConcreteProviderRoute('openrouter', 'anthropic/claude-sonnet-4.6'),
    };

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      permissionMode: 'plan',
      reasoningEffort: 'default',
      mcpEnabledServers: [],
      enabledPluginIds: [],
    })).toEqual({
      runtime: 'builtin',
      opts: {
        providerId: 'openrouter',
        model: 'anthropic/claude-sonnet-4.6',
        permissionMode: 'plan',
        reasoningEffort: 'default',
        mcpEnabledServers: [],
        enabledPluginIds: [],
      },
    });
  });

  it('carries official CLI tool selections into the new session snapshot', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'builtin-provider',
      route: createConcreteProviderRoute('anthropic', 'claude-sonnet-4-6'),
    };

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
      permissionMode: 'auto',
      reasoningEffort: 'default',
      mcpEnabledServers: [],
      enabledPluginIds: [],
      enabledOfficialToolIds: [IMAGE_UNDERSTANDING_TOOL_ID],
    }).opts.enabledOfficialToolIds).toEqual([IMAGE_UNDERSTANDING_TOOL_ID]);
  });

  it('keeps target-runtime permission and effort values for managed Codex session birth', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'runtime-backed-provider',
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      runtime: 'codex',
      runtimeSource: 'managed-provider',
      model: 'gpt-5.4-codex',
    };

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      model: 'ignored-by-runtime-backed-intent',
      permissionMode: 'fullAgency',
      reasoningEffort: 'xhigh',
      mcpEnabledServers: [],
      enabledPluginIds: [],
    }).opts).toMatchObject({
      permissionMode: 'no-restrictions',
      reasoningEffort: 'xhigh',
    });
  });

  it('maps Managed Codex Provider permission semantics onto Codex runtime permissions', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'runtime-backed-provider',
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      runtime: 'codex',
      runtimeSource: 'managed-provider',
      model: 'gpt-5.4-codex',
    };

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      model: 'ignored-by-runtime-backed-intent',
      permissionMode: 'plan',
      reasoningEffort: 'default',
      mcpEnabledServers: [],
      enabledPluginIds: [],
    }).opts.permissionMode).toBe('suggest');

    expect(buildProviderSwitchSessionBirth({
      targetIntent,
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      model: 'ignored-by-runtime-backed-intent',
      permissionMode: 'fullAgency',
      reasoningEffort: 'default',
      mcpEnabledServers: [],
      enabledPluginIds: [],
    }).opts.permissionMode).toBe('no-restrictions');
  });

  it('maps runtime-backed initial session permission before session metadata is created', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'runtime-backed-provider',
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      runtime: 'codex',
      runtimeSource: 'managed-provider',
      model: 'gpt-5.5',
    };

    expect(buildRuntimeBackedInitialSessionBirth({
      identity: targetIntent,
      permissionMode: 'fullAgency',
      reasoningEffort: 'default',
      mcpEnabledServers: [],
      enabledPluginIds: [],
    })).toEqual({
      runtime: 'codex',
      opts: {
        runtimeSource: 'managed-provider',
        providerExecutionIdentity: targetIntent,
        providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
        model: 'gpt-5.5',
        permissionMode: 'no-restrictions',
        reasoningEffort: 'default',
        mcpEnabledServers: [],
        enabledPluginIds: [],
      },
    });
  });

  it('does not invent a runtime-backed initial session permission when the caller omitted it', () => {
    const targetIntent: ProviderExecutionIntent = {
      kind: 'runtime-backed-provider',
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      runtime: 'codex',
      runtimeSource: 'managed-provider',
      model: 'gpt-5.5',
    };

    expect(buildRuntimeBackedInitialSessionBirth({
      identity: targetIntent,
    }).opts.permissionMode).toBeUndefined();
  });
});

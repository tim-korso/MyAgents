import type { AgentConfig } from '../../shared/types/agent';
import { buildRuntimeChangePatch, type RuntimeSource } from '../../shared/types/runtime';
import { CODEX_SUBSCRIPTION_PROVIDER_ID } from '../../shared/config-types';
import {
  agentDefaultsForRuntimeBackedProvider,
  createRuntimeBackedProviderIdentity,
  type RuntimeBackedProviderIdentity,
} from '../../shared/providerExecution';

export type AgentSyncSessionSnapshot = {
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  mcpEnabledServers?: string[];
  enabledOfficialToolIds?: import('../../shared/official-tools').OfficialToolId[];
  providerId?: string;
  runtimeSource?: RuntimeSource;
  providerExecutionIdentity?: RuntimeBackedProviderIdentity;
};

function runtimeBackedIdentityFromSessionSnapshot(
  session: AgentSyncSessionSnapshot,
): RuntimeBackedProviderIdentity | undefined {
  if (session.providerExecutionIdentity) return session.providerExecutionIdentity;
  if (
    session.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID
    && session.runtimeSource === 'managed-provider'
    && typeof session.model === 'string'
    && session.model.trim().length > 0
  ) {
    return createRuntimeBackedProviderIdentity({
      providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
      model: session.model,
    });
  }
  return undefined;
}

export function buildAgentPatchFromSessionSnapshot(
  session: AgentSyncSessionSnapshot,
  currentAgent?: Pick<AgentConfig, 'providerId' | 'runtimeConfig'> | null,
): Partial<Omit<AgentConfig, 'id'>> {
  const runtimeBackedIdentity = runtimeBackedIdentityFromSessionSnapshot(session);
  if (runtimeBackedIdentity) {
    return {
      ...agentDefaultsForRuntimeBackedProvider(
        runtimeBackedIdentity,
        currentAgent?.runtimeConfig,
        {
          ...(session.permissionMode !== undefined ? { permissionMode: session.permissionMode } : {}),
          ...(session.reasoningEffort !== undefined ? { reasoningEffort: session.reasoningEffort } : {}),
        },
      ),
      mcpEnabledServers: session.mcpEnabledServers,
      enabledOfficialToolIds: session.enabledOfficialToolIds,
    };
  }

  const patch: Partial<Omit<AgentConfig, 'id'>> = {
    model: session.model,
    permissionMode: session.permissionMode,
    mcpEnabledServers: session.mcpEnabledServers,
    enabledOfficialToolIds: session.enabledOfficialToolIds,
    providerId: session.providerId,
  };
  const currentAgentUsesManagedCodexProvider =
    currentAgent?.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID
    || currentAgent?.runtimeConfig?.source === 'managed-provider';
  if (currentAgentUsesManagedCodexProvider) {
    Object.assign(patch, buildRuntimeChangePatch(currentAgent?.runtimeConfig, 'builtin'));
  }
  return patch;
}

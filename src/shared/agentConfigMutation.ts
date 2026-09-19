import type { AgentConfig } from './types/agent';
import { buildRuntimeChangePatch, type RuntimeConfig } from './types/runtime';
import { CODEX_SUBSCRIPTION_PROVIDER_ID } from './config-types';
import { agentDefaultsForRuntimeBackedProvider, type RuntimeBackedProviderIdentity } from './providerExecution';

/** Field intent, resolved only by the config writer against its locked latest record. */
export type AgentConfigMutation = Partial<Omit<AgentConfig, 'id'>> & {
  runtimeConfigPatch?: Partial<RuntimeConfig>;
  runtimeBackedProviderSelection?: RuntimeBackedProviderIdentity;
};

export function resolveAgentConfigMutation(current: AgentConfig, mutation: AgentConfigMutation): Partial<Omit<AgentConfig, 'id'>> {
  const { runtimeConfigPatch, runtimeBackedProviderSelection, ...patch } = mutation;
  if (runtimeBackedProviderSelection) {
    Object.assign(patch, agentDefaultsForRuntimeBackedProvider(runtimeBackedProviderSelection, current.runtimeConfig, {
      permissionMode: mutation.permissionMode,
      reasoningEffort: mutation.reasoningEffort,
    }));
    delete patch.reasoningEffort;
  } else if (patch.runtime !== undefined && !Object.hasOwn(patch, 'runtimeConfig')) {
    Object.assign(patch, buildRuntimeChangePatch(current.runtimeConfig, patch.runtime));
  } else if (patch.providerId !== undefined && patch.providerId !== CODEX_SUBSCRIPTION_PROVIDER_ID
    && (current.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID || current.runtimeConfig?.source === 'managed-provider')) {
    Object.assign(patch, buildRuntimeChangePatch(current.runtimeConfig, 'builtin'));
  }
  if (runtimeConfigPatch) {
    patch.runtimeConfig = { ...(Object.hasOwn(patch, 'runtimeConfig') ? patch.runtimeConfig : current.runtimeConfig), ...runtimeConfigPatch };
  }
  return patch;
}

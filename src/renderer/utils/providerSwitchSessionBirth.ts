import type { ProviderExecutionIntent } from '../../shared/providerExecution';
import { runtimeBackedProviderPermissionMode } from '../../shared/providerExecution';
import {
  coerceRuntimeBirthReasoningEffort,
} from '../../shared/runtimeBirthFields';
import {
  type RuntimeSource,
  type RuntimeType,
} from '../../shared/types/runtime';
import type { OfficialToolId } from '../../shared/official-tools';

export type ProviderSwitchSessionBirth = {
  runtime: RuntimeType;
  opts: {
    runtimeSource?: RuntimeSource;
    providerExecutionIdentity?: Extract<ProviderExecutionIntent, { kind: 'runtime-backed-provider' }>;
    providerId?: string;
    model?: string;
    permissionMode?: string;
    reasoningEffort?: string;
    mcpEnabledServers?: string[];
    enabledPluginIds?: string[];
    enabledOfficialToolIds?: OfficialToolId[];
  };
};

export function buildProviderSwitchSessionBirth(args: {
  targetIntent: ProviderExecutionIntent;
  providerId: string;
  model: string;
  permissionMode: string;
  reasoningEffort: string;
  mcpEnabledServers: string[];
  enabledPluginIds: string[];
  enabledOfficialToolIds?: OfficialToolId[];
}): ProviderSwitchSessionBirth {
  const common = {
    permissionMode: args.permissionMode,
    reasoningEffort: args.reasoningEffort,
    mcpEnabledServers: args.mcpEnabledServers,
    enabledPluginIds: args.enabledPluginIds,
    ...(args.enabledOfficialToolIds !== undefined ? { enabledOfficialToolIds: args.enabledOfficialToolIds } : {}),
  };

  if (args.targetIntent.kind === 'runtime-backed-provider') {
    const permissionMode =
      runtimeBackedProviderPermissionMode(args.targetIntent, args.permissionMode);
    const reasoningEffort =
      coerceRuntimeBirthReasoningEffort(args.reasoningEffort, args.targetIntent.runtime);
    return {
      runtime: args.targetIntent.runtime,
      opts: {
        ...common,
        permissionMode,
        reasoningEffort,
        runtimeSource: args.targetIntent.runtimeSource,
        providerExecutionIdentity: args.targetIntent,
        providerId: args.targetIntent.providerId,
        model: args.targetIntent.model,
      },
    };
  }

  return {
    runtime: 'builtin',
    opts: {
      ...common,
      providerId: args.providerId,
      model: args.model,
    },
  };
}

export function buildRuntimeBackedInitialSessionBirth(args: {
  identity: Extract<ProviderExecutionIntent, { kind: 'runtime-backed-provider' }>;
  permissionMode?: string;
  reasoningEffort?: string;
  mcpEnabledServers?: string[];
  enabledPluginIds?: string[];
  enabledOfficialToolIds?: OfficialToolId[];
}): ProviderSwitchSessionBirth {
  const permissionMode =
    args.permissionMode !== undefined
      ? runtimeBackedProviderPermissionMode(args.identity, args.permissionMode)
      : undefined;
  const reasoningEffort =
    args.reasoningEffort !== undefined
      ? coerceRuntimeBirthReasoningEffort(args.reasoningEffort, args.identity.runtime)
      : undefined;
  return {
    runtime: args.identity.runtime,
    opts: {
      runtimeSource: args.identity.runtimeSource,
      providerExecutionIdentity: args.identity,
      providerId: args.identity.providerId,
      model: args.identity.model,
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(args.mcpEnabledServers !== undefined ? { mcpEnabledServers: args.mcpEnabledServers } : {}),
      ...(args.enabledPluginIds !== undefined ? { enabledPluginIds: args.enabledPluginIds } : {}),
      ...(args.enabledOfficialToolIds !== undefined ? { enabledOfficialToolIds: args.enabledOfficialToolIds } : {}),
    },
  };
}

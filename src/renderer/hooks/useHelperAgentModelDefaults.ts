// useHelperAgentModelDefaults — bridge between the BugReportOverlay's model
// picker and the helper Agent's persisted default model.
//
// The helper Agent is the AgentConfig bound to the `~/.myagents/` workspace
// (project marked `internal: true`, "MyAgents 诊断"). Like any other workspace
// Agent, its `providerId` / `model` fields define the default picked when a
// new helper session starts. This hook lets the overlay read those defaults
// AND persist back into them when the user picks a different model — same
// dual-write pattern Chat tabs use to keep workspace defaults in sync with
// the last-used selection.
//
// Returns `onModelChange = undefined` if the helper project hasn't been
// registered yet (first overlay open before any submission). Callers should
// treat that as "no persistence available" and fall back to local state only.

import { useCallback, useMemo } from 'react';

import { useConfigData } from '@/config/useConfigData';
import { patchAgentConfig } from '@/config/services/agentConfigService';
import { buildRuntimeChangePatch, type RuntimeConfig } from '@/../shared/types/runtime';
import {
    agentDefaultsForRuntimeBackedProvider,
    isRuntimeBackedProvider,
    toProviderExecutionIntent,
} from '@/../shared/providerExecution';

export interface HelperAgentModelDefaults {
    initialProviderId?: string;
    initialModel?: string;
    onModelChange?: (providerId: string, model: string) => void;
}

export function useHelperAgentModelDefaults(): HelperAgentModelDefaults {
    const { config, projects, providers } = useConfigData();

    const helperAgent = useMemo(() => {
        const helperProject = projects.find(p => p.internal === true);
        if (!helperProject?.agentId) return undefined;
        return config.agents?.find(a => a.id === helperProject.agentId);
    }, [config.agents, projects]);

    const helperAgentId = helperAgent?.id;

    const persistChange = useCallback((providerId: string, model: string) => {
        if (!helperAgentId) return;
        const provider = providers.find(p => p.id === providerId);
        const currentRuntimeConfig = helperAgent?.runtimeConfig as RuntimeConfig | undefined;
        const runtimePatch = provider && isRuntimeBackedProvider(provider)
            ? (() => {
                const intent = toProviderExecutionIntent(provider, model);
                return intent.kind === 'runtime-backed-provider'
                    ? agentDefaultsForRuntimeBackedProvider(intent, currentRuntimeConfig)
                    : buildRuntimeChangePatch(currentRuntimeConfig, 'builtin');
            })()
            : buildRuntimeChangePatch(currentRuntimeConfig, 'builtin');
        // Same dual-write semantics as patchAgentConfig calls in Chat.tsx —
        // disk + runtime sync — but the helper has no live snapshot to patch
        // (no owned Tab session is open at this moment), so the agent-level
        // write is the single source of truth.
        void patchAgentConfig(helperAgentId, {
            providerId,
            model,
            runtime: runtimePatch.runtime,
            runtimeConfig: runtimePatch.runtimeConfig,
        }).catch(err => {
            console.warn('[useHelperAgentModelDefaults] persist failed:', err);
        });
    }, [helperAgent?.runtimeConfig, helperAgentId, providers]);

    return {
        initialProviderId: helperAgent?.providerId,
        initialModel: helperAgent?.model,
        onModelChange: helperAgentId ? persistChange : undefined,
    };
}

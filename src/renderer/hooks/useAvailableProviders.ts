// useAvailableProviders — the "pit of success" provider list for any UI
// that lets the user PICK a provider/model to USE.
//
// Why this hook exists: `useConfig().providers` returns the full catalogue
// (presets + custom, regardless of whether the user has credentials). That
// is the right shape for the Settings page — you need to show providers
// without keys so the user can configure them. But every other picker —
// Chat input model switcher, Agent-settings model selector, Task-center
// per-task override, BugReport model choice — should only expose providers
// the user can actually USE (API key present, or a valid subscription).
//
// Before this hook each picker re-wrote the filter by hand:
//     providers.filter(p => isProviderAvailable(p, apiKeys, providerVerifyStatus))
// …and WorkspaceBasicsSection forgot, shipping a dropdown that exposed
// every provider including ones with no credentials. This hook makes
// "only available" the default answer — new pickers get it for free,
// and the catalogue (full list) requires explicit opt-in via useConfig.
//
// Memoized on input-object identity (`providers` / `apiKeys` /
// `providerVerifyStatus` from ConfigProvider). Those refs change whenever
// `loadAppConfig()` runs — even when the provider names / key set didn't
// actually change — so consumers that re-memo on this hook's output will
// still recompute on each SSE `config:changed` event. If that becomes a
// bottleneck, push a content-signature layer (sorted-key join) down into
// ConfigProvider rather than wrapping it here — that's where the noise
// originates.

import { useMemo } from 'react';
import { useConfig } from './useConfig';
import { isProviderAvailable } from '@/config/services/providerService';
import type { Provider } from '@/config/types';

/**
 * Hook: returns the subset of `useConfig().providers` the current user
 * can actually USE (API key present / subscription verified).
 *
 * Use this for any model/provider picker UI — DO NOT hand-roll the
 * `filter(isProviderAvailable(...))` expression. Use `useConfig()` directly
 * only when you need the full catalogue (Settings management view).
 */
export function useAvailableProviders(): Provider[] {
  const { providers, apiKeys, providerVerifyStatus } = useConfig();
  return useMemo(
    () => (providers ?? []).filter((p) => isProviderAvailable(p, apiKeys, providerVerifyStatus)),
    [providers, apiKeys, providerVerifyStatus],
  );
}

export default useAvailableProviders;

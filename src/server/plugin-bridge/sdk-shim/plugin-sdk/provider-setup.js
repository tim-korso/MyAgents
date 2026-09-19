// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/provider-setup.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/provider-setup.' + fn + '() not implemented in Bridge mode'); }
}

export function applyProviderDefaultModel() { _w('applyProviderDefaultModel'); return undefined; }
export function configureOpenAICompatibleSelfHostedProviderNonInteractive() { _w('configureOpenAICompatibleSelfHostedProviderNonInteractive'); return undefined; }
export function discoverOpenAICompatibleLocalModels() { _w('discoverOpenAICompatibleLocalModels'); return undefined; }
export function discoverOpenAICompatibleSelfHostedProvider() { _w('discoverOpenAICompatibleSelfHostedProvider'); return undefined; }
export function promptAndConfigureOpenAICompatibleSelfHostedProvider() { _w('promptAndConfigureOpenAICompatibleSelfHostedProvider'); return undefined; }
export function promptAndConfigureOpenAICompatibleSelfHostedProviderAuth() { _w('promptAndConfigureOpenAICompatibleSelfHostedProviderAuth'); return undefined; }
export const SELF_HOSTED_DEFAULT_CONTEXT_WINDOW = undefined;
export const SELF_HOSTED_DEFAULT_COST = undefined;
export const SELF_HOSTED_DEFAULT_MAX_TOKENS = undefined;

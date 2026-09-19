// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/image-generation-core.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/image-generation-core.' + fn + '() not implemented in Bridge mode'); }
}

export async function resolveApiKeyForProvider() { _w('resolveApiKeyForProvider'); return undefined; }
export function describeFailoverError() { _w('describeFailoverError'); return undefined; }
export function isFailoverError() { _w('isFailoverError'); return false; }
export function buildNoCapabilityModelConfiguredMessage() { _w('buildNoCapabilityModelConfiguredMessage'); return undefined; }
export function resolveCapabilityModelCandidates() { _w('resolveCapabilityModelCandidates'); return undefined; }
export function throwCapabilityGenerationFailure() { _w('throwCapabilityGenerationFailure'); return undefined; }
export function resolveAgentModelFallbackValues() { _w('resolveAgentModelFallbackValues'); return undefined; }
export function resolveAgentModelPrimaryValue() { _w('resolveAgentModelPrimaryValue'); return undefined; }
export function parseGeminiAuth() { _w('parseGeminiAuth'); return undefined; }
export function getImageGenerationProvider() { _w('getImageGenerationProvider'); return undefined; }
export function listImageGenerationProviders() { _w('listImageGenerationProviders'); return []; }
export function parseImageGenerationModelRef() { _w('parseImageGenerationModelRef'); return undefined; }
export function createSubsystemLogger() { _w('createSubsystemLogger'); return undefined; }
export function normalizeGoogleModelId() { _w('normalizeGoogleModelId'); return ""; }
export function getProviderEnvVars() { _w('getProviderEnvVars'); return undefined; }
export const OPENAI_DEFAULT_IMAGE_MODEL = undefined;

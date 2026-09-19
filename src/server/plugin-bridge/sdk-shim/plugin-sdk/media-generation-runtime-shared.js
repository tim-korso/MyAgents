// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/media-generation-runtime-shared.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/media-generation-runtime-shared.' + fn + '() not implemented in Bridge mode'); }
}

export function buildNoCapabilityModelConfiguredMessage() { _w('buildNoCapabilityModelConfiguredMessage'); return undefined; }
export function resolveCapabilityModelCandidates() { _w('resolveCapabilityModelCandidates'); return undefined; }
export function throwCapabilityGenerationFailure() { _w('throwCapabilityGenerationFailure'); return undefined; }

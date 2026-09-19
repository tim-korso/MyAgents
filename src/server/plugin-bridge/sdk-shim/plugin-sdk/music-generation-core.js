// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/music-generation-core.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/music-generation-core.' + fn + '() not implemented in Bridge mode'); }
}

export function describeFailoverError() { _w('describeFailoverError'); return undefined; }
export function isFailoverError() { _w('isFailoverError'); return false; }
export function resolveAgentModelFallbackValues() { _w('resolveAgentModelFallbackValues'); return undefined; }
export function resolveAgentModelPrimaryValue() { _w('resolveAgentModelPrimaryValue'); return undefined; }
export function createSubsystemLogger() { _w('createSubsystemLogger'); return undefined; }
export function parseMusicGenerationModelRef() { _w('parseMusicGenerationModelRef'); return undefined; }
export function getMusicGenerationProvider() { _w('getMusicGenerationProvider'); return undefined; }
export function listMusicGenerationProviders() { _w('listMusicGenerationProviders'); return []; }
export function getProviderEnvVars() { _w('getProviderEnvVars'); return undefined; }

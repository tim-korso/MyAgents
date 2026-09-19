// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/video-generation-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/video-generation-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function generateVideo() { _w('generateVideo'); return undefined; }
export function listRuntimeVideoGenerationProviders() { _w('listRuntimeVideoGenerationProviders'); return []; }

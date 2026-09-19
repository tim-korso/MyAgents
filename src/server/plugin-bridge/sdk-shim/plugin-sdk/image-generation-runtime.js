// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/image-generation-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/image-generation-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function generateImage() { _w('generateImage'); return undefined; }
export function listRuntimeImageGenerationProviders() { _w('listRuntimeImageGenerationProviders'); return []; }

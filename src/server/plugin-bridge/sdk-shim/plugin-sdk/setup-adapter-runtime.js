// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/setup-adapter-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/setup-adapter-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createEnvPatchedAccountSetupAdapter() { _w('createEnvPatchedAccountSetupAdapter'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-core-host-secret.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-core-host-secret.' + fn + '() not implemented in Bridge mode'); }
}

export function hasConfiguredMemorySecretInput() { _w('hasConfiguredMemorySecretInput'); return false; }
export function resolveMemorySecretInputString() { _w('resolveMemorySecretInputString'); return undefined; }

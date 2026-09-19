// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/acp-binding-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/acp-binding-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function ensureConfiguredAcpBindingReady() { _w('ensureConfiguredAcpBindingReady'); return undefined; }
export function resolveConfiguredAcpBindingRecord() { _w('resolveConfiguredAcpBindingRecord'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/global-singleton.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/global-singleton.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveGlobalSingleton() { _w('resolveGlobalSingleton'); return undefined; }
export function resolveGlobalMap() { _w('resolveGlobalMap'); return undefined; }
export function createScopedExpiringIdCache() { _w('createScopedExpiringIdCache'); return undefined; }

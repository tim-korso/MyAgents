// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/dangerous-name-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/dangerous-name-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function isDangerousNameMatchingEnabled() { _w('isDangerousNameMatchingEnabled'); return false; }
export function resolveDangerousNameMatchingEnabled() { _w('resolveDangerousNameMatchingEnabled'); return undefined; }

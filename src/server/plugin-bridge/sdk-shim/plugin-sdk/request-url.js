// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/request-url.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/request-url.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveRequestUrl() { _w('resolveRequestUrl'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/persistent-dedupe.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/persistent-dedupe.' + fn + '() not implemented in Bridge mode'); }
}

export function createPersistentDedupe() { _w('createPersistentDedupe'); return undefined; }
export function createClaimableDedupe() { _w('createClaimableDedupe'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/target-resolver-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/target-resolver-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function buildUnresolvedTargetResults() { _w('buildUnresolvedTargetResults'); return undefined; }
export function resolveTargetsWithOptionalToken() { _w('resolveTargetsWithOptionalToken'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-core-host-query.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-core-host-query.' + fn + '() not implemented in Bridge mode'); }
}

export function extractKeywords() { _w('extractKeywords'); return undefined; }
export function isQueryStopWordToken() { _w('isQueryStopWordToken'); return false; }

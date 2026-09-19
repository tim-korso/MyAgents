// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-host-search.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-host-search.' + fn + '() not implemented in Bridge mode'); }
}

export async function getActiveMemorySearchManager() { _w('getActiveMemorySearchManager'); return undefined; }
export async function closeActiveMemorySearchManagers() { _w('closeActiveMemorySearchManagers'); return undefined; }

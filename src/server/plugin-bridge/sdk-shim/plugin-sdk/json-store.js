// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/json-store.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/json-store.' + fn + '() not implemented in Bridge mode'); }
}

export async function readJsonFileWithFallback() { _w('readJsonFileWithFallback'); return undefined; }
export async function writeJsonFileAtomically() { _w('writeJsonFileAtomically'); return undefined; }
export function loadJsonFile() { _w('loadJsonFile'); return undefined; }
export function saveJsonFile() { _w('saveJsonFile'); return undefined; }

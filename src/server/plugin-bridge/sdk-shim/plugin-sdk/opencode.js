// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/opencode.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/opencode.' + fn + '() not implemented in Bridge mode'); }
}

export function createOpencodeCatalogApiKeyAuthMethod() { _w('createOpencodeCatalogApiKeyAuthMethod'); return undefined; }
export function applyOpencodeZenModelDefault() { _w('applyOpencodeZenModelDefault'); return undefined; }
export const OPENCODE_ZEN_DEFAULT_MODEL = undefined;

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/allowlist-config-edit.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/allowlist-config-edit.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveDmGroupAllowlistConfigPaths() { _w('resolveDmGroupAllowlistConfigPaths'); return undefined; }
export function resolveLegacyDmAllowlistConfigPaths() { _w('resolveLegacyDmAllowlistConfigPaths'); return undefined; }
export function readConfiguredAllowlistEntries() { _w('readConfiguredAllowlistEntries'); return undefined; }
export function collectAllowlistOverridesFromRecord() { _w('collectAllowlistOverridesFromRecord'); return []; }
export function collectNestedAllowlistOverridesFromRecord() { _w('collectNestedAllowlistOverridesFromRecord'); return []; }
export function createFlatAllowlistOverrideResolver() { _w('createFlatAllowlistOverrideResolver'); return undefined; }
export function createNestedAllowlistOverrideResolver() { _w('createNestedAllowlistOverrideResolver'); return undefined; }
export function createAccountScopedAllowlistNameResolver() { _w('createAccountScopedAllowlistNameResolver'); return undefined; }
export function buildAccountScopedAllowlistConfigEditor() { _w('buildAccountScopedAllowlistConfigEditor'); return undefined; }
export function buildDmGroupAccountAllowlistAdapter() { _w('buildDmGroupAccountAllowlistAdapter'); return undefined; }
export function buildLegacyDmAccountAllowlistAdapter() { _w('buildLegacyDmAccountAllowlistAdapter'); return undefined; }

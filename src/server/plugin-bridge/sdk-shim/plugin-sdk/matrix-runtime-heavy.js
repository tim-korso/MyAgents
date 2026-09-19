// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/matrix-runtime-heavy.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/matrix-runtime-heavy.' + fn + '() not implemented in Bridge mode'); }
}

export const autoPrepareLegacyMatrixCrypto = undefined;
export const detectLegacyMatrixCrypto = undefined;
export const autoMigrateLegacyMatrixState = undefined;
export const detectLegacyMatrixState = undefined;
export const hasActionableMatrixMigration = undefined;
export const hasPendingMatrixMigration = undefined;
export const maybeCreateMatrixMigrationSnapshot = undefined;

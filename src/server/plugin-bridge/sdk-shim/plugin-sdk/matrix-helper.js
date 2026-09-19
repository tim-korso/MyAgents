// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/matrix-helper.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/matrix-helper.' + fn + '() not implemented in Bridge mode'); }
}

export const findMatrixAccountEntry = undefined;
export const getMatrixScopedEnvVarNames = undefined;
export const requiresExplicitMatrixDefaultAccount = undefined;
export const resolveConfiguredMatrixAccountIds = undefined;
export const resolveMatrixAccountStorageRoot = undefined;
export const resolveMatrixChannelConfig = undefined;
export const resolveMatrixCredentialsDir = undefined;
export const resolveMatrixCredentialsPath = undefined;
export const resolveMatrixDefaultOrOnlyAccountId = undefined;
export const resolveMatrixLegacyFlatStoragePaths = undefined;

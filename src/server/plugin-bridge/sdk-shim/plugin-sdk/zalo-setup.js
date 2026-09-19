// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/zalo-setup.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/zalo-setup.' + fn + '() not implemented in Bridge mode'); }
}

export const evaluateZaloGroupAccess = undefined;
export const resolveZaloRuntimeGroupPolicy = undefined;
export const zaloSetupAdapter = undefined;
export const zaloSetupWizard = undefined;

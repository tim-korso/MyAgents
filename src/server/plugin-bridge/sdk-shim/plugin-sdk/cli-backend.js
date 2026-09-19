// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/cli-backend.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/cli-backend.' + fn + '() not implemented in Bridge mode'); }
}

export const CLI_FRESH_WATCHDOG_DEFAULTS = undefined;
export const CLI_RESUME_WATCHDOG_DEFAULTS = undefined;

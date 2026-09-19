// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/run-command.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/run-command.' + fn + '() not implemented in Bridge mode'); }
}

export async function runPluginCommandWithTimeout() { _w('runPluginCommandWithTimeout'); return undefined; }

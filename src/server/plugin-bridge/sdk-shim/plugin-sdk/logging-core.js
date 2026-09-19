// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/logging-core.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/logging-core.' + fn + '() not implemented in Bridge mode'); }
}

export function createSubsystemLogger() { _w('createSubsystemLogger'); return undefined; }
export function redactIdentifier() { _w('redactIdentifier'); return undefined; }
export function redactSensitiveText() { _w('redactSensitiveText'); return undefined; }

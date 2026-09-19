// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/diagnostics-otel.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/diagnostics-otel.' + fn + '() not implemented in Bridge mode'); }
}

export function emitDiagnosticEvent() { _w('emitDiagnosticEvent'); return undefined; }
export function onDiagnosticEvent() { _w('onDiagnosticEvent'); return undefined; }
export function registerLogTransport() { _w('registerLogTransport'); return undefined; }
export function redactSensitiveText() { _w('redactSensitiveText'); return undefined; }
export const emptyPluginConfigSchema = undefined;

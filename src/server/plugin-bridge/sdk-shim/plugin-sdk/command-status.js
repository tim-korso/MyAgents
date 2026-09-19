// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/command-status.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/command-status.' + fn + '() not implemented in Bridge mode'); }
}

export function buildCommandsMessage() { _w('buildCommandsMessage'); return undefined; }
export function buildCommandsMessagePaginated() { _w('buildCommandsMessagePaginated'); return undefined; }
export function buildHelpMessage() { _w('buildHelpMessage'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/command-surface.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/command-surface.' + fn + '() not implemented in Bridge mode'); }
}

export function normalizeCommandBody() { _w('normalizeCommandBody'); return ""; }
export function shouldHandleTextCommands() { _w('shouldHandleTextCommands'); return false; }

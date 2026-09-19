// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/command-detection.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/command-detection.' + fn + '() not implemented in Bridge mode'); }
}

export function hasControlCommand() { _w('hasControlCommand'); return false; }
export function hasInlineCommandTokens() { _w('hasInlineCommandTokens'); return false; }
export function isControlCommandMessage() { _w('isControlCommandMessage'); return false; }
export function shouldComputeCommandAuthorized() { _w('shouldComputeCommandAuthorized'); return false; }

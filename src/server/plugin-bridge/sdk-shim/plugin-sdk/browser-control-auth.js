// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-control-auth.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-control-auth.' + fn + '() not implemented in Bridge mode'); }
}

export async function ensureBrowserControlAuth() { _w('ensureBrowserControlAuth'); return undefined; }
export function resolveBrowserControlAuth() { _w('resolveBrowserControlAuth'); return undefined; }
export function shouldAutoGenerateBrowserAuth() { _w('shouldAutoGenerateBrowserAuth'); return false; }

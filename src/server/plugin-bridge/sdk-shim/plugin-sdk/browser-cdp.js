// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-cdp.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-cdp.' + fn + '() not implemented in Bridge mode'); }
}

export function parseBrowserHttpUrl() { _w('parseBrowserHttpUrl'); return undefined; }
export function redactCdpUrl() { _w('redactCdpUrl'); return undefined; }

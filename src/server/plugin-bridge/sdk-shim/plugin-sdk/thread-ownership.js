// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/thread-ownership.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/thread-ownership.' + fn + '() not implemented in Bridge mode'); }
}

export function definePluginEntry() { _w('definePluginEntry'); return undefined; }
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function ssrfPolicyFromDangerouslyAllowPrivateNetwork() { _w('ssrfPolicyFromDangerouslyAllowPrivateNetwork'); return undefined; }
export function ssrfPolicyFromAllowPrivateNetwork() { _w('ssrfPolicyFromAllowPrivateNetwork'); return undefined; }

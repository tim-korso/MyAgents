// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/channel-inbound-roots.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/channel-inbound-roots.' + fn + '() not implemented in Bridge mode'); }
}

export function mergeInboundPathRoots() { _w('mergeInboundPathRoots'); return undefined; }

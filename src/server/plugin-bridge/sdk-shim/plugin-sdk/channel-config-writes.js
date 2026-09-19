// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/channel-config-writes.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/channel-config-writes.' + fn + '() not implemented in Bridge mode'); }
}

export function authorizeConfigWrite() { _w('authorizeConfigWrite'); return undefined; }
export function canBypassConfigWritePolicy() { _w('canBypassConfigWritePolicy'); return false; }
export function formatConfigWriteDeniedMessage() { _w('formatConfigWriteDeniedMessage'); return ""; }
export function resolveChannelConfigWrites() { _w('resolveChannelConfigWrites'); return undefined; }

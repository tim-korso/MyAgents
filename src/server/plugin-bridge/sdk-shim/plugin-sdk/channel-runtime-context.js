// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/channel-runtime-context.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/channel-runtime-context.' + fn + '() not implemented in Bridge mode'); }
}

export function getChannelRuntimeContext() { _w('getChannelRuntimeContext'); return undefined; }
export function registerChannelRuntimeContext() { _w('registerChannelRuntimeContext'); return undefined; }
export function watchChannelRuntimeContexts() { _w('watchChannelRuntimeContexts'); return undefined; }

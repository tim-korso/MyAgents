// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/approval-handler-adapter-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/approval-handler-adapter-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export const CHANNEL_APPROVAL_NATIVE_RUNTIME_CONTEXT_CAPABILITY = undefined;
export function createLazyChannelApprovalNativeRuntimeAdapter() { _w('createLazyChannelApprovalNativeRuntimeAdapter'); return undefined; }

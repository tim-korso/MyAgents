// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/approval-handler-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/approval-handler-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createChannelApprovalHandler() { _w('createChannelApprovalHandler'); return undefined; }
export function createChannelApprovalNativeRuntimeAdapter() { _w('createChannelApprovalNativeRuntimeAdapter'); return undefined; }
export function createChannelApprovalHandlerFromCapability() { _w('createChannelApprovalHandlerFromCapability'); return undefined; }
export function createLazyChannelApprovalNativeRuntimeAdapter() { _w('createLazyChannelApprovalNativeRuntimeAdapter'); return undefined; }
export const CHANNEL_APPROVAL_NATIVE_RUNTIME_CONTEXT_CAPABILITY = undefined;
export function resolveApprovalOverGateway() { _w('resolveApprovalOverGateway'); return undefined; }

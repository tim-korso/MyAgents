// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/approval-delivery-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/approval-delivery-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createApproverRestrictedNativeApprovalAdapter() { _w('createApproverRestrictedNativeApprovalAdapter'); return undefined; }
export function createApproverRestrictedNativeApprovalCapability() { _w('createApproverRestrictedNativeApprovalCapability'); return undefined; }
export function createChannelApprovalCapability() { _w('createChannelApprovalCapability'); return undefined; }
export function splitChannelApprovalCapability() { _w('splitChannelApprovalCapability'); return undefined; }

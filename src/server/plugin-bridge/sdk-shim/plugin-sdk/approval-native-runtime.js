// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/approval-native-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/approval-native-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createChannelApproverDmTargetResolver() { _w('createChannelApproverDmTargetResolver'); return undefined; }
export function createChannelNativeOriginTargetResolver() { _w('createChannelNativeOriginTargetResolver'); return undefined; }
export function resolveApprovalRequestSessionConversation() { _w('resolveApprovalRequestSessionConversation'); return undefined; }
export function resolveApprovalRequestOriginTarget() { _w('resolveApprovalRequestOriginTarget'); return undefined; }
export function resolveApprovalRequestSessionTarget() { _w('resolveApprovalRequestSessionTarget'); return undefined; }
export function resolveExecApprovalSessionTarget() { _w('resolveExecApprovalSessionTarget'); return undefined; }
export function buildChannelApprovalNativeTargetKey() { _w('buildChannelApprovalNativeTargetKey'); return undefined; }
export function doesApprovalRequestMatchChannelAccount() { _w('doesApprovalRequestMatchChannelAccount'); return false; }
export function resolveApprovalRequestAccountId() { _w('resolveApprovalRequestAccountId'); return undefined; }
export function resolveApprovalRequestChannelAccountId() { _w('resolveApprovalRequestChannelAccountId'); return undefined; }

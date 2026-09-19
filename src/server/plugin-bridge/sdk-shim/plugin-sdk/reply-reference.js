// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/reply-reference.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/reply-reference.' + fn + '() not implemented in Bridge mode'); }
}

export function createReplyReferencePlanner() { _w('createReplyReferencePlanner'); return undefined; }
export function isSingleUseReplyToMode() { _w('isSingleUseReplyToMode'); return false; }
export function resolveBatchedReplyThreadingPolicy() { _w('resolveBatchedReplyThreadingPolicy'); return undefined; }

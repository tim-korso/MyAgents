// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/inbound-reply-dispatch.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/inbound-reply-dispatch.' + fn + '() not implemented in Bridge mode'); }
}

export async function dispatchReplyFromConfigWithSettledDispatcher() { _w('dispatchReplyFromConfigWithSettledDispatcher'); return undefined; }
export async function dispatchInboundReplyWithBase() { _w('dispatchInboundReplyWithBase'); return undefined; }
export async function recordInboundSessionAndDispatchReply() { _w('recordInboundSessionAndDispatchReply'); return undefined; }
export function buildInboundReplyDispatchBase() { _w('buildInboundReplyDispatchBase'); return undefined; }

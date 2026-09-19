// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/inbound-envelope.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/inbound-envelope.' + fn + '() not implemented in Bridge mode'); }
}

export function createInboundEnvelopeBuilder() { _w('createInboundEnvelopeBuilder'); return undefined; }
export function resolveInboundRouteEnvelopeBuilder() { _w('resolveInboundRouteEnvelopeBuilder'); return undefined; }
export function resolveInboundRouteEnvelopeBuilderWithRuntime() { _w('resolveInboundRouteEnvelopeBuilderWithRuntime'); return undefined; }

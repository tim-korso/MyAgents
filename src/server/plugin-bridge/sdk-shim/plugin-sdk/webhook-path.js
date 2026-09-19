// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/webhook-path.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/webhook-path.' + fn + '() not implemented in Bridge mode'); }
}

export function normalizeWebhookPath() { _w('normalizeWebhookPath'); return ""; }
export function resolveWebhookPath() { _w('resolveWebhookPath'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/webhook-targets.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/webhook-targets.' + fn + '() not implemented in Bridge mode'); }
}

export async function withResolvedWebhookRequestPipeline() { _w('withResolvedWebhookRequestPipeline'); return undefined; }
export async function resolveSingleWebhookTargetAsync() { _w('resolveSingleWebhookTargetAsync'); return undefined; }
export async function resolveWebhookTargetWithAuthOrReject() { _w('resolveWebhookTargetWithAuthOrReject'); return undefined; }
export function registerWebhookTargetWithPluginRoute() { _w('registerWebhookTargetWithPluginRoute'); return undefined; }
export function registerWebhookTarget() { _w('registerWebhookTarget'); return undefined; }
export function resolveWebhookTargets() { _w('resolveWebhookTargets'); return undefined; }
export function resolveSingleWebhookTarget() { _w('resolveSingleWebhookTarget'); return undefined; }
export function resolveWebhookTargetWithAuthOrRejectSync() { _w('resolveWebhookTargetWithAuthOrRejectSync'); return undefined; }
export function rejectNonPostWebhookRequest() { _w('rejectNonPostWebhookRequest'); return undefined; }
export function registerPluginHttpRoute() { _w('registerPluginHttpRoute'); return undefined; }

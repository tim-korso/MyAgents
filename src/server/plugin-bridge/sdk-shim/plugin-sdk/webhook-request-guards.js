// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/webhook-request-guards.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/webhook-request-guards.' + fn + '() not implemented in Bridge mode'); }
}

export async function readWebhookBodyOrReject() { _w('readWebhookBodyOrReject'); return undefined; }
export async function readJsonWebhookBodyOrReject() { _w('readJsonWebhookBodyOrReject'); return undefined; }
export function createWebhookInFlightLimiter() { _w('createWebhookInFlightLimiter'); return undefined; }
export function isJsonContentType() { _w('isJsonContentType'); return false; }
export function applyBasicWebhookRequestGuards() { _w('applyBasicWebhookRequestGuards'); return undefined; }
export function beginWebhookRequestPipelineOrReject() { _w('beginWebhookRequestPipelineOrReject'); return undefined; }
export const WEBHOOK_BODY_READ_DEFAULTS = undefined;
export const WEBHOOK_IN_FLIGHT_DEFAULTS = undefined;
export function installRequestBodyLimitGuard() { _w('installRequestBodyLimitGuard'); return undefined; }
export function isRequestBodyLimitError() { _w('isRequestBodyLimitError'); return false; }
export function readJsonBodyWithLimit() { _w('readJsonBodyWithLimit'); return undefined; }
export function readRequestBodyWithLimit() { _w('readRequestBodyWithLimit'); return undefined; }
export function requestBodyErrorToText() { _w('requestBodyErrorToText'); return undefined; }

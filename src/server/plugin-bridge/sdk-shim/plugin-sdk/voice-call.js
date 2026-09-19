// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/voice-call.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/voice-call.' + fn + '() not implemented in Bridge mode'); }
}

export function definePluginEntry() { _w('definePluginEntry'); return undefined; }
export const TtsAutoSchema = undefined;
export const TtsConfigSchema = undefined;
export const TtsModeSchema = undefined;
export const TtsProviderSchema = undefined;
export function isRequestBodyLimitError() { _w('isRequestBodyLimitError'); return false; }
export function readRequestBodyWithLimit() { _w('readRequestBodyWithLimit'); return undefined; }
export function requestBodyErrorToText() { _w('requestBodyErrorToText'); return undefined; }
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function sleep() { _w('sleep'); return undefined; }

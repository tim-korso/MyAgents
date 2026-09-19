// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/error-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/error-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export class RequestScopedSubagentRuntimeError { constructor() { _w('RequestScopedSubagentRuntimeError'); } }
export const SUBAGENT_RUNTIME_REQUEST_SCOPE_ERROR_CODE = undefined;
export const SUBAGENT_RUNTIME_REQUEST_SCOPE_ERROR_MESSAGE = undefined;
export function collectErrorGraphCandidates() { _w('collectErrorGraphCandidates'); return []; }
export function extractErrorCode() { _w('extractErrorCode'); return undefined; }
export function formatErrorMessage() { _w('formatErrorMessage'); return ""; }
export function formatUncaughtError() { _w('formatUncaughtError'); return ""; }
export function readErrorName() { _w('readErrorName'); return undefined; }
export function isApprovalNotFoundError() { _w('isApprovalNotFoundError'); return false; }

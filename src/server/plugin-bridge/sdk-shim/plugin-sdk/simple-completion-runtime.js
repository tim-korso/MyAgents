// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/simple-completion-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/simple-completion-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function extractAssistantText() { _w('extractAssistantText'); return undefined; }
export async function prepareSimpleCompletionModel() { _w('prepareSimpleCompletionModel'); return undefined; }
export async function prepareSimpleCompletionModelForAgent() { _w('prepareSimpleCompletionModelForAgent'); return undefined; }
export async function completeWithPreparedSimpleCompletionModel() { _w('completeWithPreparedSimpleCompletionModel'); return undefined; }
export function resolveSimpleCompletionSelectionForAgent() { _w('resolveSimpleCompletionSelectionForAgent'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/thread-bindings-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/thread-bindings-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveThreadBindingConversationIdFromBindingId() { _w('resolveThreadBindingConversationIdFromBindingId'); return undefined; }
export function resolveThreadBindingFarewellText() { _w('resolveThreadBindingFarewellText'); return undefined; }
export function resolveThreadBindingIdleTimeoutMsForChannel() { _w('resolveThreadBindingIdleTimeoutMsForChannel'); return undefined; }
export function resolveThreadBindingLifecycle() { _w('resolveThreadBindingLifecycle'); return undefined; }
export function resolveThreadBindingMaxAgeMsForChannel() { _w('resolveThreadBindingMaxAgeMsForChannel'); return undefined; }
export function createAccountScopedConversationBindingManager() { _w('createAccountScopedConversationBindingManager'); return undefined; }
export function resetAccountScopedConversationBindingsForTests() { _w('resetAccountScopedConversationBindingsForTests'); return undefined; }
export function registerSessionBindingAdapter() { _w('registerSessionBindingAdapter'); return undefined; }
export function unregisterSessionBindingAdapter() { _w('unregisterSessionBindingAdapter'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/lazy-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/lazy-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createLazyRuntimeModule() { _w('createLazyRuntimeModule'); return undefined; }
export function createLazyRuntimeMethod() { _w('createLazyRuntimeMethod'); return undefined; }
export function createLazyRuntimeMethodBinder() { _w('createLazyRuntimeMethodBinder'); return undefined; }
export function createLazyRuntimeNamedExport() { _w('createLazyRuntimeNamedExport'); return undefined; }
export function createLazyRuntimeSurface() { _w('createLazyRuntimeSurface'); return undefined; }

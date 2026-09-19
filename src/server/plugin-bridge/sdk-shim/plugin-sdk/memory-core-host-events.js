// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-core-host-events.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-core-host-events.' + fn + '() not implemented in Bridge mode'); }
}

export async function appendMemoryHostEvent() { _w('appendMemoryHostEvent'); return undefined; }
export async function readMemoryHostEvents() { _w('readMemoryHostEvents'); return undefined; }
export function resolveMemoryHostEventLogPath() { _w('resolveMemoryHostEventLogPath'); return undefined; }
export const MEMORY_HOST_EVENT_LOG_RELATIVE_PATH = undefined;

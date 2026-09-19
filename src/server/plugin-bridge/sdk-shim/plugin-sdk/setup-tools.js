// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/setup-tools.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/setup-tools.' + fn + '() not implemented in Bridge mode'); }
}

export function formatCliCommand() { _w('formatCliCommand'); return ""; }
export function extractArchive() { _w('extractArchive'); return undefined; }
export function resolveBrewExecutable() { _w('resolveBrewExecutable'); return undefined; }
export function detectBinary() { _w('detectBinary'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export const CONFIG_DIR = undefined;

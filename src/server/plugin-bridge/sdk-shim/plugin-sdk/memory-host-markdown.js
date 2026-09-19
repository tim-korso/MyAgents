// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-host-markdown.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-host-markdown.' + fn + '() not implemented in Bridge mode'); }
}

export function withTrailingNewline() { _w('withTrailingNewline'); return undefined; }
export function replaceManagedMarkdownBlock() { _w('replaceManagedMarkdownBlock'); return undefined; }

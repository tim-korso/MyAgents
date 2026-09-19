// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/web-media.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/web-media.' + fn + '() not implemented in Bridge mode'); }
}

export function getDefaultLocalRoots() { _w('getDefaultLocalRoots'); return undefined; }
export function LocalMediaAccessError() { _w('LocalMediaAccessError'); return undefined; }
export function loadWebMedia() { _w('loadWebMedia'); return undefined; }
export function loadWebMediaRaw() { _w('loadWebMediaRaw'); return undefined; }
export function optimizeImageToJpeg() { _w('optimizeImageToJpeg'); return undefined; }
export function optimizeImageToPng() { _w('optimizeImageToPng'); return undefined; }

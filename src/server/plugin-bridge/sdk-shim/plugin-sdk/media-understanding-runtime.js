// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/media-understanding-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/media-understanding-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function describeImageFile() { _w('describeImageFile'); return undefined; }
export function describeImageFileWithModel() { _w('describeImageFileWithModel'); return undefined; }
export function describeVideoFile() { _w('describeVideoFile'); return undefined; }
export function runMediaUnderstandingFile() { _w('runMediaUnderstandingFile'); return undefined; }
export function transcribeAudioFile() { _w('transcribeAudioFile'); return undefined; }

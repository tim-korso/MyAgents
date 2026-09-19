// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-setup-tools.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-setup-tools.' + fn + '() not implemented in Bridge mode'); }
}

export function imageResultFromFile() { _w('imageResultFromFile'); return undefined; }
export function jsonResult() { _w('jsonResult'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function listNodes() { _w('listNodes'); return []; }
export function resolveNodeIdFromList() { _w('resolveNodeIdFromList'); return undefined; }
export function selectDefaultNodeFromList() { _w('selectDefaultNodeFromList'); return undefined; }
export function callGatewayTool() { _w('callGatewayTool'); return undefined; }
export function optionalStringEnum() { _w('optionalStringEnum'); return undefined; }
export function stringEnum() { _w('stringEnum'); return undefined; }
export function formatCliCommand() { _w('formatCliCommand'); return ""; }
export function inheritOptionFromParent() { _w('inheritOptionFromParent'); return undefined; }
export function formatHelpExamples() { _w('formatHelpExamples'); return ""; }
export function danger() { _w('danger'); return undefined; }
export function info() { _w('info'); return undefined; }
export const IMAGE_REDUCE_QUALITY_STEPS = undefined;
export function buildImageResizeSideGrid() { _w('buildImageResizeSideGrid'); return undefined; }
export function getImageMetadata() { _w('getImageMetadata'); return undefined; }
export function resizeToJpeg() { _w('resizeToJpeg'); return undefined; }
export function detectMime() { _w('detectMime'); return undefined; }
export function ensureMediaDir() { _w('ensureMediaDir'); return undefined; }
export function saveMediaBuffer() { _w('saveMediaBuffer'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function note() { _w('note'); return undefined; }
export function theme() { _w('theme'); return undefined; }
export function captureEnv() { _w('captureEnv'); return undefined; }
export function withEnv() { _w('withEnv'); return undefined; }
export function withEnvAsync() { _w('withEnvAsync'); return undefined; }
export function withFetchPreconnect() { _w('withFetchPreconnect'); return undefined; }
export function createTempHomeEnv() { _w('createTempHomeEnv'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/video-generation.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/video-generation.' + fn + '() not implemented in Bridge mode'); }
}

export const DASHSCOPE_WAN_VIDEO_CAPABILITIES = undefined;
export const DASHSCOPE_WAN_VIDEO_MODELS = undefined;
export const DEFAULT_DASHSCOPE_WAN_VIDEO_MODEL = undefined;
export const DEFAULT_VIDEO_GENERATION_DURATION_SECONDS = undefined;
export const DEFAULT_VIDEO_GENERATION_TIMEOUT_MS = undefined;
export const DEFAULT_VIDEO_RESOLUTION_TO_SIZE = undefined;
export function buildDashscopeVideoGenerationInput() { _w('buildDashscopeVideoGenerationInput'); return undefined; }
export function buildDashscopeVideoGenerationParameters() { _w('buildDashscopeVideoGenerationParameters'); return undefined; }
export function downloadDashscopeGeneratedVideos() { _w('downloadDashscopeGeneratedVideos'); return undefined; }
export function extractDashscopeVideoUrls() { _w('extractDashscopeVideoUrls'); return undefined; }
export function pollDashscopeVideoTaskUntilComplete() { _w('pollDashscopeVideoTaskUntilComplete'); return undefined; }
export function resolveVideoGenerationReferenceUrls() { _w('resolveVideoGenerationReferenceUrls'); return undefined; }
export function runDashscopeVideoGenerationTask() { _w('runDashscopeVideoGenerationTask'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/provider-tools.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/provider-tools.' + fn + '() not implemented in Bridge mode'); }
}

export function stripUnsupportedSchemaKeywords() { _w('stripUnsupportedSchemaKeywords'); return ""; }
export function stripXaiUnsupportedKeywords() { _w('stripXaiUnsupportedKeywords'); return ""; }
export function resolveXaiModelCompatPatch() { _w('resolveXaiModelCompatPatch'); return undefined; }
export function applyXaiModelCompat() { _w('applyXaiModelCompat'); return undefined; }
export function findUnsupportedSchemaKeywords() { _w('findUnsupportedSchemaKeywords'); return undefined; }
export function normalizeGeminiToolSchemas() { _w('normalizeGeminiToolSchemas'); return ""; }
export function inspectGeminiToolSchemas() { _w('inspectGeminiToolSchemas'); return undefined; }
export function normalizeOpenAIToolSchemas() { _w('normalizeOpenAIToolSchemas'); return ""; }
export function findOpenAIStrictSchemaViolations() { _w('findOpenAIStrictSchemaViolations'); return undefined; }
export function inspectOpenAIToolSchemas() { _w('inspectOpenAIToolSchemas'); return undefined; }
export function buildProviderToolCompatFamilyHooks() { _w('buildProviderToolCompatFamilyHooks'); return undefined; }
export const XAI_TOOL_SCHEMA_PROFILE = undefined;
export const HTML_ENTITY_TOOL_CALL_ARGUMENTS_ENCODING = undefined;
export const XAI_UNSUPPORTED_SCHEMA_KEYWORDS = undefined;
export function cleanSchemaForGemini() { _w('cleanSchemaForGemini'); return undefined; }
export const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS = undefined;

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/provider-usage.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/provider-usage.' + fn + '() not implemented in Bridge mode'); }
}

export function fetchClaudeUsage() { _w('fetchClaudeUsage'); return undefined; }
export function fetchCodexUsage() { _w('fetchCodexUsage'); return undefined; }
export function fetchGeminiUsage() { _w('fetchGeminiUsage'); return undefined; }
export function fetchMinimaxUsage() { _w('fetchMinimaxUsage'); return undefined; }
export function fetchZaiUsage() { _w('fetchZaiUsage'); return undefined; }
export function clampPercent() { _w('clampPercent'); return undefined; }
export const PROVIDER_LABELS = undefined;
export function resolveLegacyPiAgentAccessToken() { _w('resolveLegacyPiAgentAccessToken'); return undefined; }
export function buildUsageErrorSnapshot() { _w('buildUsageErrorSnapshot'); return undefined; }
export function buildUsageHttpErrorSnapshot() { _w('buildUsageHttpErrorSnapshot'); return undefined; }
export function fetchJson() { _w('fetchJson'); return undefined; }

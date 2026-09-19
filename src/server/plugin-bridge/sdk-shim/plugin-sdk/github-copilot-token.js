// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/github-copilot-token.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/github-copilot-token.' + fn + '() not implemented in Bridge mode'); }
}

export async function resolveCopilotApiToken() { _w('resolveCopilotApiToken'); return undefined; }
export function deriveCopilotApiBaseUrlFromToken() { _w('deriveCopilotApiBaseUrlFromToken'); return undefined; }
export const DEFAULT_COPILOT_API_BASE_URL = undefined;

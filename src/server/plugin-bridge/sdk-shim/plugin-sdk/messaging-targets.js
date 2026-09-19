// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/messaging-targets.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/messaging-targets.' + fn + '() not implemented in Bridge mode'); }
}

export function buildMessagingTarget() { _w('buildMessagingTarget'); return undefined; }
export function ensureTargetId() { _w('ensureTargetId'); return undefined; }
export function normalizeTargetId() { _w('normalizeTargetId'); return ""; }
export function parseAtUserTarget() { _w('parseAtUserTarget'); return undefined; }
export function parseMentionPrefixOrAtUserTarget() { _w('parseMentionPrefixOrAtUserTarget'); return undefined; }
export function parseTargetMention() { _w('parseTargetMention'); return undefined; }
export function parseTargetPrefix() { _w('parseTargetPrefix'); return undefined; }
export function parseTargetPrefixes() { _w('parseTargetPrefixes'); return undefined; }
export function requireTargetKind() { _w('requireTargetKind'); return undefined; }

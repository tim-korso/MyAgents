// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/windows-spawn.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/windows-spawn.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveWindowsExecutablePath() { _w('resolveWindowsExecutablePath'); return undefined; }
export function resolveWindowsSpawnProgramCandidate() { _w('resolveWindowsSpawnProgramCandidate'); return undefined; }
export function applyWindowsSpawnProgramPolicy() { _w('applyWindowsSpawnProgramPolicy'); return undefined; }
export function resolveWindowsSpawnProgram() { _w('resolveWindowsSpawnProgram'); return undefined; }
export function materializeWindowsSpawnProgram() { _w('materializeWindowsSpawnProgram'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/memory-core.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/memory-core.' + fn + '() not implemented in Bridge mode'); }
}

export function getMemorySearchManager() { _w('getMemorySearchManager'); return undefined; }
export function MemoryIndexManager() { _w('MemoryIndexManager'); return undefined; }
export const DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = undefined;
export const emptyPluginConfigSchema = undefined;
export function jsonResult() { _w('jsonResult'); return undefined; }
export const loadConfig = undefined;
export function parseAgentSessionKey() { _w('parseAgentSessionKey'); return undefined; }
export function parseNonNegativeByteSize() { _w('parseNonNegativeByteSize'); return undefined; }
export function readNumberParam() { _w('readNumberParam'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function resolveCronStyleNow() { _w('resolveCronStyleNow'); return undefined; }
export function resolveDefaultAgentId() { _w('resolveDefaultAgentId'); return undefined; }
export const resolveMemorySearchConfig = undefined;
export function resolveSessionAgentId() { _w('resolveSessionAgentId'); return undefined; }
export function resolveSessionTranscriptsDirForAgent() { _w('resolveSessionTranscriptsDirForAgent'); return undefined; }
export function resolveStateDir() { _w('resolveStateDir'); return undefined; }
export const SILENT_REPLY_TOKEN = undefined;
export function colorize() { _w('colorize'); return undefined; }
export function defaultRuntime() { _w('defaultRuntime'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function formatErrorMessage() { _w('formatErrorMessage'); return ""; }
export function formatHelpExamples() { _w('formatHelpExamples'); return ""; }
export function isRich() { _w('isRich'); return false; }
export function isVerbose() { _w('isVerbose'); return false; }
export function resolveCommandSecretRefsViaGateway() { _w('resolveCommandSecretRefsViaGateway'); return undefined; }
export function setVerbose() { _w('setVerbose'); return undefined; }
export function shortenHomeInString() { _w('shortenHomeInString'); return undefined; }
export function shortenHomePath() { _w('shortenHomePath'); return undefined; }
export function theme() { _w('theme'); return undefined; }
export function withManager() { _w('withManager'); return undefined; }
export function withProgress() { _w('withProgress'); return undefined; }
export function withProgressTotals() { _w('withProgressTotals'); return undefined; }
export function appendMemoryHostEvent() { _w('appendMemoryHostEvent'); return undefined; }
export function readMemoryHostEvents() { _w('readMemoryHostEvents'); return undefined; }
export function resolveMemoryHostEventLogPath() { _w('resolveMemoryHostEventLogPath'); return undefined; }
export const resolveMemoryCorePluginConfig = undefined;
export function formatMemoryDreamingDay() { _w('formatMemoryDreamingDay'); return ""; }
export function isSameMemoryDreamingDay() { _w('isSameMemoryDreamingDay'); return false; }
export const resolveMemoryDeepDreamingConfig = undefined;
export const resolveMemoryDreamingConfig = undefined;
export function resolveMemoryDreamingWorkspaces() { _w('resolveMemoryDreamingWorkspaces'); return undefined; }
export function listMemoryFiles() { _w('listMemoryFiles'); return []; }
export function normalizeExtraMemoryPaths() { _w('normalizeExtraMemoryPaths'); return ""; }
export function readAgentMemoryFile() { _w('readAgentMemoryFile'); return undefined; }
export const resolveMemoryBackendConfig = undefined;

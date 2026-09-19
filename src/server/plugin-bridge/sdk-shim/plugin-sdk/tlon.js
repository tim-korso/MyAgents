// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/tlon.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/tlon.' + fn + '() not implemented in Bridge mode'); }
}

export const tlonSetupAdapter = undefined;
export const tlonSetupWizard = undefined;
export const buildChannelConfigSchema = undefined;
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export const patchScopedAccountConfig = undefined;
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function createDedupeCache() { _w('createDedupeCache'); return undefined; }
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function isBlockedHostnameOrIp() { _w('isBlockedHostnameOrIp'); return false; }
export function SsrFBlockedError() { _w('SsrFBlockedError'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function createLoggerBackedRuntime() { _w('createLoggerBackedRuntime'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/nostr.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/nostr.' + fn + '() not implemented in Bridge mode'); }
}

export const nostrSetupAdapter = undefined;
export const nostrSetupWizard = undefined;
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function getPluginRuntimeGatewayRequestScope() { _w('getPluginRuntimeGatewayRequestScope'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function createDirectDmPreCryptoGuardPolicy() { _w('createDirectDmPreCryptoGuardPolicy'); return undefined; }
export function dispatchInboundDirectDmWithRuntime() { _w('dispatchInboundDirectDmWithRuntime'); return undefined; }
export function createPreCryptoDirectDmAuthorizer() { _w('createPreCryptoDirectDmAuthorizer'); return undefined; }
export function resolveInboundDirectDmAccessWithRuntime() { _w('resolveInboundDirectDmAccessWithRuntime'); return undefined; }
export const MarkdownConfigSchema = undefined;
export function readJsonBodyWithLimit() { _w('readJsonBodyWithLimit'); return undefined; }
export function requestBodyErrorToText() { _w('requestBodyErrorToText'); return undefined; }
export function isBlockedHostnameOrIp() { _w('isBlockedHostnameOrIp'); return false; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function collectStatusIssuesFromLastError() { _w('collectStatusIssuesFromLastError'); return []; }
export function createDefaultChannelRuntimeState() { _w('createDefaultChannelRuntimeState'); return undefined; }
export function createFixedWindowRateLimiter() { _w('createFixedWindowRateLimiter'); return undefined; }
export function mapAllowFromEntries() { _w('mapAllowFromEntries'); return undefined; }

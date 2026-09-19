// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/msteams.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/msteams.' + fn + '() not implemented in Bridge mode'); }
}

export const msteamsSetupWizard = undefined;
export const msteamsSetupAdapter = undefined;
export function buildPendingHistoryContextFromMap() { _w('buildPendingHistoryContextFromMap'); return undefined; }
export function clearHistoryEntriesIfEnabled() { _w('clearHistoryEntriesIfEnabled'); return undefined; }
export const DEFAULT_GROUP_HISTORY_LIMIT = undefined;
export function recordPendingHistoryEntryIfEnabled() { _w('recordPendingHistoryEntryIfEnabled'); return undefined; }
export function isSilentReplyText() { _w('isSilentReplyText'); return false; }
export const SILENT_REPLY_TOKEN = undefined;
export function mergeAllowlist() { _w('mergeAllowlist'); return undefined; }
export function summarizeMapping() { _w('summarizeMapping'); return undefined; }
export function resolveControlCommandGate() { _w('resolveControlCommandGate'); return undefined; }
export function resolveDualTextControlCommandGate() { _w('resolveDualTextControlCommandGate'); return undefined; }
export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function logTypingFailure() { _w('logTypingFailure'); return undefined; }
export function resolveInboundMentionDecision() { _w('resolveInboundMentionDecision'); return undefined; }
export function resolveMentionGating() { _w('resolveMentionGating'); return undefined; }
export function resolveMentionGatingWithBypass() { _w('resolveMentionGatingWithBypass'); return undefined; }
export function formatAllowlistMatchMeta() { _w('formatAllowlistMatchMeta'); return ""; }
export function resolveAllowlistMatchSimple() { _w('resolveAllowlistMatchSimple'); return undefined; }
export function buildChannelKeyCandidates() { _w('buildChannelKeyCandidates'); return undefined; }
export function normalizeChannelSlug() { _w('normalizeChannelSlug'); return ""; }
export function resolveChannelEntryMatchWithFallback() { _w('resolveChannelEntryMatchWithFallback'); return undefined; }
export function resolveNestedAllowlistDecision() { _w('resolveNestedAllowlistDecision'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function resolveChannelMediaMaxBytes() { _w('resolveChannelMediaMaxBytes'); return undefined; }
export function buildMediaPayload() { _w('buildMediaPayload'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function setTopLevelChannelAllowFrom() { _w('setTopLevelChannelAllowFrom'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export function setTopLevelChannelGroupPolicy() { _w('setTopLevelChannelGroupPolicy'); return undefined; }
export function splitSetupEntries() { _w('splitSetupEntries'); return undefined; }
export const PAIRING_APPROVED_MESSAGE = undefined;
export function resolveOutboundMediaUrls() { _w('resolveOutboundMediaUrls'); return undefined; }
export function resolveSendableOutboundReplyParts() { _w('resolveSendableOutboundReplyParts'); return undefined; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function isDangerousNameMatchingEnabled() { _w('isDangerousNameMatchingEnabled'); return false; }
export function resolveChannelContextVisibilityMode() { _w('resolveChannelContextVisibilityMode'); return undefined; }
export function resolveToolsBySender() { _w('resolveToolsBySender'); return undefined; }
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function hasConfiguredSecretInput() { _w('hasConfiguredSecretInput'); return false; }
export function normalizeResolvedSecretInputString() { _w('normalizeResolvedSecretInputString'); return ""; }
export function normalizeSecretInputString() { _w('normalizeSecretInputString'); return ""; }
export const MSTeamsConfigSchema = undefined;
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = undefined;
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function isPrivateIpAddress() { _w('isPrivateIpAddress'); return false; }
export function detectMime() { _w('detectMime'); return undefined; }
export function extensionForMime() { _w('extensionForMime'); return undefined; }
export function getFileExtension() { _w('getFileExtension'); return undefined; }
export function extractOriginalFilename() { _w('extractOriginalFilename'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function readStoreAllowFromForDmPolicy() { _w('readStoreAllowFromForDmPolicy'); return undefined; }
export function resolveDmGroupAccessWithLists() { _w('resolveDmGroupAccessWithLists'); return undefined; }
export function resolveEffectiveAllowFromLists() { _w('resolveEffectiveAllowFromLists'); return undefined; }
export function evaluateSenderGroupAccessForPolicy() { _w('evaluateSenderGroupAccessForPolicy'); return undefined; }
export function resolveSenderScopedGroupPolicy() { _w('resolveSenderScopedGroupPolicy'); return undefined; }
export function filterSupplementalContextItems() { _w('filterSupplementalContextItems'); return undefined; }
export function shouldIncludeSupplementalContext() { _w('shouldIncludeSupplementalContext'); return false; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function sleep() { _w('sleep'); return undefined; }
export function loadWebMedia() { _w('loadWebMedia'); return undefined; }
export function keepHttpServerTaskAlive() { _w('keepHttpServerTaskAlive'); return undefined; }
export function withFileLock() { _w('withFileLock'); return undefined; }
export function dispatchReplyFromConfigWithSettledDispatcher() { _w('dispatchReplyFromConfigWithSettledDispatcher'); return undefined; }
export function readJsonFileWithFallback() { _w('readJsonFileWithFallback'); return undefined; }
export function writeJsonFileAtomically() { _w('writeJsonFileAtomically'); return undefined; }
export function loadOutboundMediaFromUrl() { _w('loadOutboundMediaFromUrl'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function resolveInboundSessionEnvelopeContext() { _w('resolveInboundSessionEnvelopeContext'); return undefined; }
export function buildHostnameAllowlistPolicyFromSuffixAllowlist() { _w('buildHostnameAllowlistPolicyFromSuffixAllowlist'); return undefined; }
export function isHttpsUrlAllowedByHostnameSuffixAllowlist() { _w('isHttpsUrlAllowedByHostnameSuffixAllowlist'); return false; }
export function normalizeHostnameSuffixAllowlist() { _w('normalizeHostnameSuffixAllowlist'); return ""; }
export function buildBaseChannelStatusSummary() { _w('buildBaseChannelStatusSummary'); return undefined; }
export function buildProbeChannelStatusSummary() { _w('buildProbeChannelStatusSummary'); return undefined; }
export function buildRuntimeAccountStatusSnapshot() { _w('buildRuntimeAccountStatusSnapshot'); return undefined; }
export function createDefaultChannelRuntimeState() { _w('createDefaultChannelRuntimeState'); return undefined; }
export function normalizeStringEntries() { _w('normalizeStringEntries'); return ""; }

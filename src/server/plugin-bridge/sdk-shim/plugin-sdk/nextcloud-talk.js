// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/nextcloud-talk.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/nextcloud-talk.' + fn + '() not implemented in Bridge mode'); }
}

export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function createAuthRateLimiter() { _w('createAuthRateLimiter'); return undefined; }
export function resolveMentionGating() { _w('resolveMentionGating'); return undefined; }
export function resolveMentionGatingWithBypass() { _w('resolveMentionGatingWithBypass'); return undefined; }
export function resolveInboundMentionDecision() { _w('resolveInboundMentionDecision'); return undefined; }
export function buildChannelKeyCandidates() { _w('buildChannelKeyCandidates'); return undefined; }
export function normalizeChannelSlug() { _w('normalizeChannelSlug'); return ""; }
export function resolveChannelEntryMatchWithFallback() { _w('resolveChannelEntryMatchWithFallback'); return undefined; }
export function resolveNestedAllowlistDecision() { _w('resolveNestedAllowlistDecision'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function clearAccountEntryFields() { _w('clearAccountEntryFields'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function buildSingleChannelSecretPromptState() { _w('buildSingleChannelSecretPromptState'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function promptSingleChannelSecretInput() { _w('promptSingleChannelSecretInput'); return undefined; }
export function runSingleChannelSecretStep() { _w('runSingleChannelSecretStep'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function createSetupInputPresenceValidator() { _w('createSetupInputPresenceValidator'); return undefined; }
export const patchScopedAccountConfig = undefined;
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function mapAllowFromEntries() { _w('mapAllowFromEntries'); return undefined; }
export function evaluateMatchedGroupAccessForPolicy() { _w('evaluateMatchedGroupAccessForPolicy'); return undefined; }
export const GROUP_POLICY_BLOCKED_LABEL = undefined;
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export const buildSecretInputSchema = undefined;
export function hasConfiguredSecretInput() { _w('hasConfiguredSecretInput'); return false; }
export function normalizeResolvedSecretInputString() { _w('normalizeResolvedSecretInputString'); return ""; }
export function normalizeSecretInputString() { _w('normalizeSecretInputString'); return ""; }
export const ToolPolicySchema = undefined;
export const BlockStreamingCoalesceSchema = undefined;
export const DmConfigSchema = undefined;
export const DmPolicySchema = undefined;
export const GroupPolicySchema = undefined;
export const MarkdownConfigSchema = undefined;
export function ReplyRuntimeConfigSchemaShape() { _w('ReplyRuntimeConfigSchemaShape'); return undefined; }
export function requireOpenAllowFrom() { _w('requireOpenAllowFrom'); return undefined; }
export const WEBHOOK_RATE_LIMIT_DEFAULTS = undefined;
export function isRequestBodyLimitError() { _w('isRequestBodyLimitError'); return false; }
export function readRequestBodyWithLimit() { _w('readRequestBodyWithLimit'); return undefined; }
export function requestBodyErrorToText() { _w('requestBodyErrorToText'); return undefined; }
export function waitForAbortSignal() { _w('waitForAbortSignal'); return undefined; }
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function readStoreAllowFromForDmPolicy() { _w('readStoreAllowFromForDmPolicy'); return undefined; }
export function resolveDmGroupAccessWithCommandGate() { _w('resolveDmGroupAccessWithCommandGate'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function listConfiguredAccountIds() { _w('listConfiguredAccountIds'); return []; }
export function resolveAccountWithDefaultFallback() { _w('resolveAccountWithDefaultFallback'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function createPersistentDedupe() { _w('createPersistentDedupe'); return undefined; }
export function createNormalizedOutboundDeliverer() { _w('createNormalizedOutboundDeliverer'); return undefined; }
export function deliverFormattedTextWithAttachments() { _w('deliverFormattedTextWithAttachments'); return undefined; }
export function formatTextWithAttachmentLinks() { _w('formatTextWithAttachmentLinks'); return ""; }
export function resolveOutboundMediaUrls() { _w('resolveOutboundMediaUrls'); return undefined; }
export function dispatchInboundReplyWithBase() { _w('dispatchInboundReplyWithBase'); return undefined; }
export function createLoggerBackedRuntime() { _w('createLoggerBackedRuntime'); return undefined; }
export function buildBaseChannelStatusSummary() { _w('buildBaseChannelStatusSummary'); return undefined; }
export function buildRuntimeAccountStatusSnapshot() { _w('buildRuntimeAccountStatusSnapshot'); return undefined; }
export function createTopLevelChannelDmPolicy() { _w('createTopLevelChannelDmPolicy'); return undefined; }
export function promptParsedAllowFromForAccount() { _w('promptParsedAllowFromForAccount'); return undefined; }
export function resolveSetupAccountId() { _w('resolveSetupAccountId'); return undefined; }
export function setSetupChannelEnabled() { _w('setSetupChannelEnabled'); return undefined; }

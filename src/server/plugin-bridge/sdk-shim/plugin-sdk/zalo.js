// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/zalo.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/zalo.' + fn + '() not implemented in Bridge mode'); }
}

export function jsonResult() { _w('jsonResult'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export function listDirectoryUserEntriesFromAllowFrom() { _w('listDirectoryUserEntriesFromAllowFrom'); return []; }
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function buildSingleChannelSecretPromptState() { _w('buildSingleChannelSecretPromptState'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function promptSingleChannelSecretInput() { _w('promptSingleChannelSecretInput'); return undefined; }
export function runSingleChannelSecretStep() { _w('runSingleChannelSecretStep'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export const PAIRING_APPROVED_MESSAGE = undefined;
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function applySetupAccountConfigPatch() { _w('applySetupAccountConfigPatch'); return undefined; }
export function migrateBaseNameToDefaultAccount() { _w('migrateBaseNameToDefaultAccount'); return undefined; }
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function logTypingFailure() { _w('logTypingFailure'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function resolveOpenProviderRuntimeGroupPolicy() { _w('resolveOpenProviderRuntimeGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export const buildSecretInputSchema = undefined;
export function hasConfiguredSecretInput() { _w('hasConfiguredSecretInput'); return false; }
export function normalizeResolvedSecretInputString() { _w('normalizeResolvedSecretInputString'); return ""; }
export function normalizeSecretInputString() { _w('normalizeSecretInputString'); return ""; }
export const MarkdownConfigSchema = undefined;
export function waitForAbortSignal() { _w('waitForAbortSignal'); return undefined; }
export function createDedupeCache() { _w('createDedupeCache'); return undefined; }
export function resolveClientIp() { _w('resolveClientIp'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function formatAllowFromLowercase() { _w('formatAllowFromLowercase'); return ""; }
export function isNormalizedSenderAllowed() { _w('isNormalizedSenderAllowed'); return false; }
export function zaloSetupAdapter() { _w('zaloSetupAdapter'); return undefined; }
export function zaloSetupWizard() { _w('zaloSetupWizard'); return undefined; }
export function evaluateZaloGroupAccess() { _w('evaluateZaloGroupAccess'); return undefined; }
export function resolveZaloRuntimeGroupPolicy() { _w('resolveZaloRuntimeGroupPolicy'); return undefined; }
export function resolveDirectDmAuthorizationOutcome() { _w('resolveDirectDmAuthorizationOutcome'); return undefined; }
export function resolveSenderCommandAuthorizationWithRuntime() { _w('resolveSenderCommandAuthorizationWithRuntime'); return undefined; }
export function resolveChannelAccountConfigBasePath() { _w('resolveChannelAccountConfigBasePath'); return undefined; }
export function evaluateSenderGroupAccess() { _w('evaluateSenderGroupAccess'); return undefined; }
export function resolveInboundRouteEnvelopeBuilderWithRuntime() { _w('resolveInboundRouteEnvelopeBuilderWithRuntime'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function buildChannelSendResult() { _w('buildChannelSendResult'); return undefined; }
export function deliverTextOrMediaReply() { _w('deliverTextOrMediaReply'); return undefined; }
export function isNumericTargetId() { _w('isNumericTargetId'); return false; }
export function resolveOutboundMediaUrls() { _w('resolveOutboundMediaUrls'); return undefined; }
export function sendMediaWithLeadingCaption() { _w('sendMediaWithLeadingCaption'); return undefined; }
export function sendPayloadWithChunkedTextAndMedia() { _w('sendPayloadWithChunkedTextAndMedia'); return undefined; }
export function buildBaseAccountStatusSnapshot() { _w('buildBaseAccountStatusSnapshot'); return undefined; }
export function buildTokenChannelStatusSummary() { _w('buildTokenChannelStatusSummary'); return undefined; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function extractToolSend() { _w('extractToolSend'); return undefined; }
export function applyBasicWebhookRequestGuards() { _w('applyBasicWebhookRequestGuards'); return undefined; }
export function createFixedWindowRateLimiter() { _w('createFixedWindowRateLimiter'); return undefined; }
export function createWebhookAnomalyTracker() { _w('createWebhookAnomalyTracker'); return undefined; }
export function readJsonWebhookBodyOrReject() { _w('readJsonWebhookBodyOrReject'); return undefined; }
export function registerWebhookTarget() { _w('registerWebhookTarget'); return undefined; }
export function registerWebhookTargetWithPluginRoute() { _w('registerWebhookTargetWithPluginRoute'); return undefined; }
export function resolveSingleWebhookTarget() { _w('resolveSingleWebhookTarget'); return undefined; }
export function resolveWebhookPath() { _w('resolveWebhookPath'); return undefined; }
export function resolveWebhookTargetWithAuthOrRejectSync() { _w('resolveWebhookTargetWithAuthOrRejectSync'); return undefined; }
export function resolveWebhookTargets() { _w('resolveWebhookTargets'); return undefined; }
export const WEBHOOK_ANOMALY_COUNTER_DEFAULTS = undefined;
export const WEBHOOK_RATE_LIMIT_DEFAULTS = undefined;
export function withResolvedWebhookRequestPipeline() { _w('withResolvedWebhookRequestPipeline'); return undefined; }

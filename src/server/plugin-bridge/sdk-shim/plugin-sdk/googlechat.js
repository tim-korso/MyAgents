// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/googlechat.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/googlechat.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveGoogleChatGroupRequireMention() { _w('resolveGoogleChatGroupRequireMention'); return undefined; }
export const googlechatSetupAdapter = undefined;
export const googlechatSetupWizard = undefined;
export function createActionGate() { _w('createActionGate'); return undefined; }
export function jsonResult() { _w('jsonResult'); return undefined; }
export function readNumberParam() { _w('readNumberParam'); return undefined; }
export function readReactionParams() { _w('readReactionParams'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function resolveMentionGating() { _w('resolveMentionGating'); return undefined; }
export function resolveMentionGatingWithBypass() { _w('resolveMentionGatingWithBypass'); return undefined; }
export function resolveInboundMentionDecision() { _w('resolveInboundMentionDecision'); return undefined; }
export function getChatChannelMeta() { _w('getChatChannelMeta'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export function listDirectoryGroupEntriesFromMapKeys() { _w('listDirectoryGroupEntriesFromMapKeys'); return []; }
export function listDirectoryUserEntriesFromAllowFrom() { _w('listDirectoryUserEntriesFromAllowFrom'); return []; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function createAccountStatusSink() { _w('createAccountStatusSink'); return undefined; }
export function runPassiveAccountLifecycle() { _w('runPassiveAccountLifecycle'); return undefined; }
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function fetchRemoteMedia() { _w('fetchRemoteMedia'); return undefined; }
export function resolveChannelMediaMaxBytes() { _w('resolveChannelMediaMaxBytes'); return undefined; }
export function loadOutboundMediaFromUrl() { _w('loadOutboundMediaFromUrl'); return undefined; }
export function loadWebMedia() { _w('loadWebMedia'); return undefined; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function splitSetupEntries() { _w('splitSetupEntries'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export const PAIRING_APPROVED_MESSAGE = undefined;
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function applySetupAccountConfigPatch() { _w('applySetupAccountConfigPatch'); return undefined; }
export function migrateBaseNameToDefaultAccount() { _w('migrateBaseNameToDefaultAccount'); return undefined; }
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function isDangerousNameMatchingEnabled() { _w('isDangerousNameMatchingEnabled'); return false; }
export const GROUP_POLICY_BLOCKED_LABEL = undefined;
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export function isSecretRef() { _w('isSecretRef'); return false; }
export const GoogleChatConfigSchema = undefined;
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function missingTargetError() { _w('missingTargetError'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function resolveDmGroupAccessWithLists() { _w('resolveDmGroupAccessWithLists'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function resolveInboundRouteEnvelopeBuilderWithRuntime() { _w('resolveInboundRouteEnvelopeBuilderWithRuntime'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function evaluateGroupRouteAccessForPolicy() { _w('evaluateGroupRouteAccessForPolicy'); return undefined; }
export function resolveSenderScopedGroupPolicy() { _w('resolveSenderScopedGroupPolicy'); return undefined; }
export function extractToolSend() { _w('extractToolSend'); return undefined; }
export function beginWebhookRequestPipelineOrReject() { _w('beginWebhookRequestPipelineOrReject'); return undefined; }
export function createWebhookInFlightLimiter() { _w('createWebhookInFlightLimiter'); return undefined; }
export function readJsonWebhookBodyOrReject() { _w('readJsonWebhookBodyOrReject'); return undefined; }
export function registerWebhookTargetWithPluginRoute() { _w('registerWebhookTargetWithPluginRoute'); return undefined; }
export function resolveWebhookPath() { _w('resolveWebhookPath'); return undefined; }
export function resolveWebhookTargetWithAuthOrReject() { _w('resolveWebhookTargetWithAuthOrReject'); return undefined; }
export function resolveWebhookTargets() { _w('resolveWebhookTargets'); return undefined; }
export function withResolvedWebhookRequestPipeline() { _w('withResolvedWebhookRequestPipeline'); return undefined; }

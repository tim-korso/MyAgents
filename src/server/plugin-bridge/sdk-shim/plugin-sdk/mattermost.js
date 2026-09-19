// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/mattermost.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/mattermost.' + fn + '() not implemented in Bridge mode'); }
}

export function formatInboundFromLabel() { _w('formatInboundFromLabel'); return ""; }
export function buildPendingHistoryContextFromMap() { _w('buildPendingHistoryContextFromMap'); return undefined; }
export function clearHistoryEntriesIfEnabled() { _w('clearHistoryEntriesIfEnabled'); return undefined; }
export const DEFAULT_GROUP_HISTORY_LIMIT = undefined;
export function recordPendingHistoryEntryIfEnabled() { _w('recordPendingHistoryEntryIfEnabled'); return undefined; }
export function listSkillCommandsForAgents() { _w('listSkillCommandsForAgents'); return []; }
export function resolveControlCommandGate() { _w('resolveControlCommandGate'); return undefined; }
export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function logTypingFailure() { _w('logTypingFailure'); return undefined; }
export function resolveAllowlistMatchSimple() { _w('resolveAllowlistMatchSimple'); return undefined; }
export function normalizeProviderId() { _w('normalizeProviderId'); return ""; }
export function buildModelsProviderData() { _w('buildModelsProviderData'); return undefined; }
export function resolveStoredModelOverride() { _w('resolveStoredModelOverride'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function resolveChannelMediaMaxBytes() { _w('resolveChannelMediaMaxBytes'); return undefined; }
export function buildSingleChannelSecretPromptState() { _w('buildSingleChannelSecretPromptState'); return undefined; }
export function promptSingleChannelSecretInput() { _w('promptSingleChannelSecretInput'); return undefined; }
export function runSingleChannelSecretStep() { _w('runSingleChannelSecretStep'); return undefined; }
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function applySetupAccountConfigPatch() { _w('applySetupAccountConfigPatch'); return undefined; }
export function createSetupInputPresenceValidator() { _w('createSetupInputPresenceValidator'); return undefined; }
export function migrateBaseNameToDefaultAccount() { _w('migrateBaseNameToDefaultAccount'); return undefined; }
export function createAccountStatusSink() { _w('createAccountStatusSink'); return undefined; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function isDangerousNameMatchingEnabled() { _w('isDangerousNameMatchingEnabled'); return false; }
export function loadSessionStore() { _w('loadSessionStore'); return undefined; }
export function resolveStorePath() { _w('resolveStorePath'); return undefined; }
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export const BlockStreamingCoalesceSchema = undefined;
export const DmPolicySchema = undefined;
export const GroupPolicySchema = undefined;
export const MarkdownConfigSchema = undefined;
export function requireOpenAllowFrom() { _w('requireOpenAllowFrom'); return undefined; }
export function createDedupeCache() { _w('createDedupeCache'); return undefined; }
export function parseStrictPositiveInteger() { _w('parseStrictPositiveInteger'); return undefined; }
export function rawDataToString() { _w('rawDataToString'); return undefined; }
export function isLoopbackHost() { _w('isLoopbackHost'); return false; }
export function isTrustedProxyAddress() { _w('isTrustedProxyAddress'); return false; }
export function resolveClientIp() { _w('resolveClientIp'); return undefined; }
export function registerPluginHttpRoute() { _w('registerPluginHttpRoute'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function resolveThreadSessionKeys() { _w('resolveThreadSessionKeys'); return undefined; }
export const DM_GROUP_ACCESS_REASON = undefined;
export function readStoreAllowFromForDmPolicy() { _w('readStoreAllowFromForDmPolicy'); return undefined; }
export function resolveDmGroupAccessWithLists() { _w('resolveDmGroupAccessWithLists'); return undefined; }
export function resolveEffectiveAllowFromLists() { _w('resolveEffectiveAllowFromLists'); return undefined; }
export function evaluateSenderGroupAccessForPolicy() { _w('evaluateSenderGroupAccessForPolicy'); return undefined; }
export function buildAgentMediaPayload() { _w('buildAgentMediaPayload'); return undefined; }
export function getAgentScopedMediaLocalRoots() { _w('getAgentScopedMediaLocalRoots'); return undefined; }
export function loadOutboundMediaFromUrl() { _w('loadOutboundMediaFromUrl'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function isRequestBodyLimitError() { _w('isRequestBodyLimitError'); return false; }
export function readRequestBodyWithLimit() { _w('readRequestBodyWithLimit'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/matrix.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/matrix.' + fn + '() not implemented in Bridge mode'); }
}

export const singleAccountKeysToMove = undefined;
export const namedAccountPromotionKeys = undefined;
export const resolveSingleAccountPromotionTarget = undefined;
export const matrixSetupWizard = undefined;
export const matrixSetupAdapter = undefined;
export function createActionGate() { _w('createActionGate'); return undefined; }
export function jsonResult() { _w('jsonResult'); return undefined; }
export function readNumberParam() { _w('readNumberParam'); return undefined; }
export function readReactionParams() { _w('readReactionParams'); return undefined; }
export function readStringArrayParam() { _w('readStringArrayParam'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function resolveAckReaction() { _w('resolveAckReaction'); return undefined; }
export function compileAllowlist() { _w('compileAllowlist'); return undefined; }
export function resolveCompiledAllowlistMatch() { _w('resolveCompiledAllowlistMatch'); return undefined; }
export function resolveAllowlistCandidates() { _w('resolveAllowlistCandidates'); return undefined; }
export function resolveAllowlistMatchByCandidates() { _w('resolveAllowlistMatchByCandidates'); return undefined; }
export function addAllowlistUserEntriesFromConfigEntry() { _w('addAllowlistUserEntriesFromConfigEntry'); return undefined; }
export function buildAllowlistResolutionSummary() { _w('buildAllowlistResolutionSummary'); return undefined; }
export function canonicalizeAllowlistWithResolvedIds() { _w('canonicalizeAllowlistWithResolvedIds'); return undefined; }
export function mergeAllowlist() { _w('mergeAllowlist'); return undefined; }
export function patchAllowlistUsersInConfigEntries() { _w('patchAllowlistUsersInConfigEntries'); return undefined; }
export function summarizeMapping() { _w('summarizeMapping'); return undefined; }
export function resolveControlCommandGate() { _w('resolveControlCommandGate'); return undefined; }
export function formatLocationText() { _w('formatLocationText'); return ""; }
export function toLocationContext() { _w('toLocationContext'); return undefined; }
export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function logTypingFailure() { _w('logTypingFailure'); return undefined; }
export function formatAllowlistMatchMeta() { _w('formatAllowlistMatchMeta'); return ""; }
export function buildChannelKeyCandidates() { _w('buildChannelKeyCandidates'); return undefined; }
export function resolveChannelEntryMatch() { _w('resolveChannelEntryMatch'); return undefined; }
export function getChatChannelMeta() { _w('getChatChannelMeta'); return undefined; }
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function buildSingleChannelSecretPromptState() { _w('buildSingleChannelSecretPromptState'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function promptAccountId() { _w('promptAccountId'); return undefined; }
export function promptSingleChannelSecretInput() { _w('promptSingleChannelSecretInput'); return undefined; }
export function setTopLevelChannelGroupPolicy() { _w('setTopLevelChannelGroupPolicy'); return undefined; }
export const promptChannelAccessConfig = undefined;
export const PAIRING_APPROVED_MESSAGE = undefined;
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function moveSingleAccountChannelSectionToDefaultAccount() { _w('moveSingleAccountChannelSectionToDefaultAccount'); return undefined; }
export function createReplyPrefixOptions() { _w('createReplyPrefixOptions'); return undefined; }
export function resolveThreadBindingFarewellText() { _w('resolveThreadBindingFarewellText'); return undefined; }
export function resolveThreadBindingIdleTimeoutMsForChannel() { _w('resolveThreadBindingIdleTimeoutMsForChannel'); return undefined; }
export function resolveThreadBindingMaxAgeMsForChannel() { _w('resolveThreadBindingMaxAgeMsForChannel'); return undefined; }
export function setMatrixThreadBindingIdleTimeoutBySessionKey() { _w('setMatrixThreadBindingIdleTimeoutBySessionKey'); return undefined; }
export function setMatrixThreadBindingMaxAgeBySessionKey() { _w('setMatrixThreadBindingMaxAgeBySessionKey'); return undefined; }
export function createTypingCallbacks() { _w('createTypingCallbacks'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function loadOutboundMediaFromUrl() { _w('loadOutboundMediaFromUrl'); return undefined; }
export const GROUP_POLICY_BLOCKED_LABEL = undefined;
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export const buildSecretInputSchema = undefined;
export function hasConfiguredSecretInput() { _w('hasConfiguredSecretInput'); return false; }
export function normalizeResolvedSecretInputString() { _w('normalizeResolvedSecretInputString'); return ""; }
export function normalizeSecretInputString() { _w('normalizeSecretInputString'); return ""; }
export const ToolPolicySchema = undefined;
export const MarkdownConfigSchema = undefined;
export function formatZonedTimestamp() { _w('formatZonedTimestamp'); return ""; }
export function fetchWithSsrFGuard() { _w('fetchWithSsrFGuard'); return undefined; }
export function getSessionBindingService() { _w('getSessionBindingService'); return undefined; }
export function registerSessionBindingAdapter() { _w('registerSessionBindingAdapter'); return undefined; }
export function unregisterSessionBindingAdapter() { _w('unregisterSessionBindingAdapter'); return undefined; }
export function resolveOutboundSendDep() { _w('resolveOutboundSendDep'); return undefined; }
export function isPrivateOrLoopbackHost() { _w('isPrivateOrLoopbackHost'); return false; }
export function getAgentScopedMediaLocalRoots() { _w('getAgentScopedMediaLocalRoots'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export function normalizePollInput() { _w('normalizePollInput'); return ""; }
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function normalizeOptionalAccountId() { _w('normalizeOptionalAccountId'); return ""; }
export function resolveAgentIdFromSessionKey() { _w('resolveAgentIdFromSessionKey'); return undefined; }
export function normalizeStringEntries() { _w('normalizeStringEntries'); return ""; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function redactSensitiveText() { _w('redactSensitiveText'); return undefined; }
export function evaluateGroupRouteAccessForPolicy() { _w('evaluateGroupRouteAccessForPolicy'); return undefined; }
export function resolveSenderScopedGroupPolicy() { _w('resolveSenderScopedGroupPolicy'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function readJsonFileWithFallback() { _w('readJsonFileWithFallback'); return undefined; }
export function writeJsonFileAtomically() { _w('writeJsonFileAtomically'); return undefined; }
export function formatResolvedUnresolvedNote() { _w('formatResolvedUnresolvedNote'); return ""; }
export function runPluginCommandWithTimeout() { _w('runPluginCommandWithTimeout'); return undefined; }
export function createLoggerBackedRuntime() { _w('createLoggerBackedRuntime'); return undefined; }
export function resolveRuntimeEnv() { _w('resolveRuntimeEnv'); return undefined; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function buildProbeChannelStatusSummary() { _w('buildProbeChannelStatusSummary'); return undefined; }
export function collectStatusIssuesFromLastError() { _w('collectStatusIssuesFromLastError'); return []; }
export function findMatrixAccountEntry() { _w('findMatrixAccountEntry'); return undefined; }
export function resolveConfiguredMatrixAccountIds() { _w('resolveConfiguredMatrixAccountIds'); return undefined; }
export const resolveMatrixChannelConfig = undefined;
export function resolveMatrixAccountStorageRoot() { _w('resolveMatrixAccountStorageRoot'); return undefined; }
export function resolveMatrixCredentialsDir() { _w('resolveMatrixCredentialsDir'); return undefined; }
export function resolveMatrixCredentialsPath() { _w('resolveMatrixCredentialsPath'); return undefined; }
export function resolveMatrixLegacyFlatStoragePaths() { _w('resolveMatrixLegacyFlatStoragePaths'); return undefined; }
export function resolveMatrixAccountStringValues() { _w('resolveMatrixAccountStringValues'); return undefined; }
export function getMatrixScopedEnvVarNames() { _w('getMatrixScopedEnvVarNames'); return undefined; }
export function requiresExplicitMatrixDefaultAccount() { _w('requiresExplicitMatrixDefaultAccount'); return undefined; }
export function resolveMatrixDefaultOrOnlyAccountId() { _w('resolveMatrixDefaultOrOnlyAccountId'); return undefined; }
export function createMatrixThreadBindingManager() { _w('createMatrixThreadBindingManager'); return undefined; }
export function resetMatrixThreadBindingsForTests() { _w('resetMatrixThreadBindingsForTests'); return undefined; }
export function setMatrixRuntime() { _w('setMatrixRuntime'); return undefined; }

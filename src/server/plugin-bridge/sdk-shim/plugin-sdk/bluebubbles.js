// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/bluebubbles.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/bluebubbles.' + fn + '() not implemented in Bridge mode'); }
}

export function createBlueBubblesConversationBindingManager() { _w('createBlueBubblesConversationBindingManager'); return undefined; }
export function normalizeBlueBubblesAcpConversationId() { _w('normalizeBlueBubblesAcpConversationId'); return ""; }
export function matchBlueBubblesAcpConversation() { _w('matchBlueBubblesAcpConversation'); return undefined; }
export function resolveBlueBubblesConversationIdFromTarget() { _w('resolveBlueBubblesConversationIdFromTarget'); return undefined; }
export function collectBlueBubblesStatusIssues() { _w('collectBlueBubblesStatusIssues'); return []; }
export function resolveAckReaction() { _w('resolveAckReaction'); return undefined; }
export function createActionGate() { _w('createActionGate'); return undefined; }
export function jsonResult() { _w('jsonResult'); return undefined; }
export function readNumberParam() { _w('readNumberParam'); return undefined; }
export function readReactionParams() { _w('readReactionParams'); return undefined; }
export function readStringParam() { _w('readStringParam'); return undefined; }
export function evictOldHistoryKeys() { _w('evictOldHistoryKeys'); return undefined; }
export function recordPendingHistoryEntryIfEnabled() { _w('recordPendingHistoryEntryIfEnabled'); return undefined; }
export function resolveControlCommandGate() { _w('resolveControlCommandGate'); return undefined; }
export function logAckFailure() { _w('logAckFailure'); return undefined; }
export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function logTypingFailure() { _w('logTypingFailure'); return undefined; }
export const BLUEBUBBLES_ACTION_NAMES = undefined;
export const BLUEBUBBLES_ACTIONS = undefined;
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function resolveBlueBubblesGroupRequireMention() { _w('resolveBlueBubblesGroupRequireMention'); return undefined; }
export function resolveBlueBubblesGroupToolPolicy() { _w('resolveBlueBubblesGroupToolPolicy'); return undefined; }
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function resolveChannelMediaMaxBytes() { _w('resolveChannelMediaMaxBytes'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export const PAIRING_APPROVED_MESSAGE = undefined;
export function applyAccountNameToChannelSection() { _w('applyAccountNameToChannelSection'); return undefined; }
export function migrateBaseNameToDefaultAccount() { _w('migrateBaseNameToDefaultAccount'); return undefined; }
export const patchScopedAccountConfig = undefined;
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export const ToolPolicySchema = undefined;
export const MarkdownConfigSchema = undefined;
export function parseChatAllowTargetPrefixes() { _w('parseChatAllowTargetPrefixes'); return undefined; }
export function parseChatTargetPrefixesOrThrow() { _w('parseChatTargetPrefixesOrThrow'); return undefined; }
export function resolveServicePrefixedAllowTarget() { _w('resolveServicePrefixedAllowTarget'); return undefined; }
export function resolveServicePrefixedTarget() { _w('resolveServicePrefixedTarget'); return undefined; }
export function stripMarkdown() { _w('stripMarkdown'); return ""; }
export function parseFiniteNumber() { _w('parseFiniteNumber'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export const DM_GROUP_ACCESS_REASON = undefined;
export function readStoreAllowFromForDmPolicy() { _w('readStoreAllowFromForDmPolicy'); return undefined; }
export function resolveDmGroupAccessWithLists() { _w('resolveDmGroupAccessWithLists'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function isAllowedParsedChatSender() { _w('isAllowedParsedChatSender'); return false; }
export function readBooleanParam() { _w('readBooleanParam'); return undefined; }
export function mapAllowFromEntries() { _w('mapAllowFromEntries'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function resolveRequestUrl() { _w('resolveRequestUrl'); return undefined; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function buildProbeChannelStatusSummary() { _w('buildProbeChannelStatusSummary'); return undefined; }
export function isAllowedBlueBubblesSender() { _w('isAllowedBlueBubblesSender'); return false; }
export function extractToolSend() { _w('extractToolSend'); return undefined; }
export const WEBHOOK_RATE_LIMIT_DEFAULTS = undefined;
export function createFixedWindowRateLimiter() { _w('createFixedWindowRateLimiter'); return undefined; }
export function createWebhookInFlightLimiter() { _w('createWebhookInFlightLimiter'); return undefined; }
export function normalizeWebhookPath() { _w('normalizeWebhookPath'); return ""; }
export function readWebhookBodyOrReject() { _w('readWebhookBodyOrReject'); return undefined; }
export function registerWebhookTargetWithPluginRoute() { _w('registerWebhookTargetWithPluginRoute'); return undefined; }
export function resolveRequestClientIp() { _w('resolveRequestClientIp'); return undefined; }
export function resolveWebhookTargets() { _w('resolveWebhookTargets'); return undefined; }
export function resolveWebhookTargetWithAuthOrRejectSync() { _w('resolveWebhookTargetWithAuthOrRejectSync'); return undefined; }
export function withResolvedWebhookRequestPipeline() { _w('withResolvedWebhookRequestPipeline'); return undefined; }

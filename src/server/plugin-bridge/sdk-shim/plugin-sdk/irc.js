// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/irc.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/irc.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveControlCommandGate() { _w('resolveControlCommandGate'); return undefined; }
export function logInboundDrop() { _w('logInboundDrop'); return undefined; }
export function deleteAccountFromConfigSection() { _w('deleteAccountFromConfigSection'); return undefined; }
export function setAccountEnabledInConfigSection() { _w('setAccountEnabledInConfigSection'); return undefined; }
export function createAccountListHelpers() { _w('createAccountListHelpers'); return undefined; }
export const buildChannelConfigSchema = undefined;
export function formatPairingApproveHint() { _w('formatPairingApproveHint'); return ""; }
export function parseOptionalDelimitedEntries() { _w('parseOptionalDelimitedEntries'); return undefined; }
export function addWildcardAllowFrom() { _w('addWildcardAllowFrom'); return undefined; }
export function setTopLevelChannelAllowFrom() { _w('setTopLevelChannelAllowFrom'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export const PAIRING_APPROVED_MESSAGE = undefined;
export const patchScopedAccountConfig = undefined;
export function getChatChannelMeta() { _w('getChatChannelMeta'); return undefined; }
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export function chunkTextForOutbound() { _w('chunkTextForOutbound'); return undefined; }
export function isDangerousNameMatchingEnabled() { _w('isDangerousNameMatchingEnabled'); return false; }
export const GROUP_POLICY_BLOCKED_LABEL = undefined;
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function warnMissingProviderGroupPolicyFallbackOnce() { _w('warnMissingProviderGroupPolicyFallbackOnce'); return undefined; }
export function normalizeResolvedSecretInputString() { _w('normalizeResolvedSecretInputString'); return ""; }
export const ToolPolicySchema = undefined;
export const BlockStreamingCoalesceSchema = undefined;
export const DmConfigSchema = undefined;
export const DmPolicySchema = undefined;
export const GroupPolicySchema = undefined;
export const MarkdownConfigSchema = undefined;
export function ReplyRuntimeConfigSchemaShape() { _w('ReplyRuntimeConfigSchemaShape'); return undefined; }
export function requireOpenAllowFrom() { _w('requireOpenAllowFrom'); return undefined; }
export const emptyPluginConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function createAccountStatusSink() { _w('createAccountStatusSink'); return undefined; }
export function runPassiveAccountLifecycle() { _w('runPassiveAccountLifecycle'); return undefined; }
export function listIrcAccountIds() { _w('listIrcAccountIds'); return []; }
export function resolveDefaultIrcAccountId() { _w('resolveDefaultIrcAccountId'); return undefined; }
export function resolveIrcAccount() { _w('resolveIrcAccount'); return undefined; }
export function readStoreAllowFromForDmPolicy() { _w('readStoreAllowFromForDmPolicy'); return undefined; }
export function resolveEffectiveAllowFromLists() { _w('resolveEffectiveAllowFromLists'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function dispatchInboundReplyWithBase() { _w('dispatchInboundReplyWithBase'); return undefined; }
export function ircSetupAdapter() { _w('ircSetupAdapter'); return undefined; }
export function ircSetupWizard() { _w('ircSetupWizard'); return undefined; }
export function createNormalizedOutboundDeliverer() { _w('createNormalizedOutboundDeliverer'); return undefined; }
export function deliverFormattedTextWithAttachments() { _w('deliverFormattedTextWithAttachments'); return undefined; }
export function formatTextWithAttachmentLinks() { _w('formatTextWithAttachmentLinks'); return ""; }
export function resolveOutboundMediaUrls() { _w('resolveOutboundMediaUrls'); return undefined; }
export function createLoggerBackedRuntime() { _w('createLoggerBackedRuntime'); return undefined; }
export function buildBaseAccountStatusSnapshot() { _w('buildBaseAccountStatusSnapshot'); return undefined; }
export function buildBaseChannelStatusSummary() { _w('buildBaseChannelStatusSummary'); return undefined; }

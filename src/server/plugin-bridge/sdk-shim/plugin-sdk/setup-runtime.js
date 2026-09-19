// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/setup-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/setup-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createClackPrompter() { _w('createClackPrompter'); return undefined; }
export const DEFAULT_ACCOUNT_ID = undefined;
export function createEnvPatchedAccountSetupAdapter() { _w('createEnvPatchedAccountSetupAdapter'); return undefined; }
export function createPatchedAccountSetupAdapter() { _w('createPatchedAccountSetupAdapter'); return undefined; }
export function createSetupInputPresenceValidator() { _w('createSetupInputPresenceValidator'); return undefined; }
export function createAccountScopedAllowFromSection() { _w('createAccountScopedAllowFromSection'); return undefined; }
export function createAccountScopedGroupAccessSection() { _w('createAccountScopedGroupAccessSection'); return undefined; }
export function createTopLevelChannelDmPolicy() { _w('createTopLevelChannelDmPolicy'); return undefined; }
export function createLegacyCompatChannelDmPolicy() { _w('createLegacyCompatChannelDmPolicy'); return undefined; }
export function createStandardChannelSetupStatus() { _w('createStandardChannelSetupStatus'); return undefined; }
export function mergeAllowFromEntries() { _w('mergeAllowFromEntries'); return undefined; }
export function noteChannelLookupFailure() { _w('noteChannelLookupFailure'); return undefined; }
export function noteChannelLookupSummary() { _w('noteChannelLookupSummary'); return undefined; }
export function parseSetupEntriesAllowingWildcard() { _w('parseSetupEntriesAllowingWildcard'); return undefined; }
export function parseMentionOrPrefixedId() { _w('parseMentionOrPrefixedId'); return undefined; }
export function patchChannelConfigForAccount() { _w('patchChannelConfigForAccount'); return undefined; }
export function promptResolvedAllowFrom() { _w('promptResolvedAllowFrom'); return undefined; }
export function promptLegacyChannelAllowFromForAccount() { _w('promptLegacyChannelAllowFromForAccount'); return undefined; }
export function promptParsedAllowFromForAccount() { _w('promptParsedAllowFromForAccount'); return undefined; }
export function resolveEntriesWithOptionalToken() { _w('resolveEntriesWithOptionalToken'); return undefined; }
export function resolveSetupAccountId() { _w('resolveSetupAccountId'); return undefined; }
export function setAccountAllowFromForChannel() { _w('setAccountAllowFromForChannel'); return undefined; }
export function setSetupChannelEnabled() { _w('setSetupChannelEnabled'); return undefined; }
export function splitSetupEntries() { _w('splitSetupEntries'); return undefined; }
export function createAllowlistSetupWizardProxy() { _w('createAllowlistSetupWizardProxy'); return undefined; }
export function createCliPathTextInput() { _w('createCliPathTextInput'); return undefined; }
export function createDelegatedTextInputShouldPrompt() { _w('createDelegatedTextInputShouldPrompt'); return undefined; }
export function createDelegatedSetupWizardProxy() { _w('createDelegatedSetupWizardProxy'); return undefined; }

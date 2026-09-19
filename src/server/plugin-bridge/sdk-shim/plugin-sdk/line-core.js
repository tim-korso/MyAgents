// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/line-core.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/line-core.' + fn + '() not implemented in Bridge mode'); }
}

export function createTopLevelChannelDmPolicy() { _w('createTopLevelChannelDmPolicy'); return undefined; }
export const DEFAULT_ACCOUNT_ID = undefined;
export function setSetupChannelEnabled() { _w('setSetupChannelEnabled'); return undefined; }
export function setTopLevelChannelDmPolicyWithAllowFrom() { _w('setTopLevelChannelDmPolicyWithAllowFrom'); return undefined; }
export function splitSetupEntries() { _w('splitSetupEntries'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function listLineAccountIds() { _w('listLineAccountIds'); return []; }
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function resolveDefaultLineAccountId() { _w('resolveDefaultLineAccountId'); return undefined; }
export function resolveLineAccount() { _w('resolveLineAccount'); return undefined; }
export function resolveExactLineGroupConfigKey() { _w('resolveExactLineGroupConfigKey'); return undefined; }
export const LineConfigSchema = undefined;
export function createActionCard() { _w('createActionCard'); return undefined; }
export function createImageCard() { _w('createImageCard'); return undefined; }
export function createInfoCard() { _w('createInfoCard'); return undefined; }
export function createListCard() { _w('createListCard'); return undefined; }
export function createReceiptCard() { _w('createReceiptCard'); return undefined; }
export function processLineMessage() { _w('processLineMessage'); return undefined; }

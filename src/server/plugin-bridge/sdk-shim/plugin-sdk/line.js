// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/line.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/line.' + fn + '() not implemented in Bridge mode'); }
}

export const DEFAULT_ACCOUNT_ID = undefined;
export const buildChannelConfigSchema = undefined;
export const emptyPluginConfigSchema = undefined;
export function clearAccountEntryFields() { _w('clearAccountEntryFields'); return undefined; }
export function resolveAllowlistProviderRuntimeGroupPolicy() { _w('resolveAllowlistProviderRuntimeGroupPolicy'); return undefined; }
export function resolveDefaultGroupPolicy() { _w('resolveDefaultGroupPolicy'); return undefined; }
export function buildComputedAccountStatusSnapshot() { _w('buildComputedAccountStatusSnapshot'); return undefined; }
export function buildTokenChannelStatusSummary() { _w('buildTokenChannelStatusSummary'); return undefined; }
export function listLineAccountIds() { _w('listLineAccountIds'); return []; }
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export function resolveDefaultLineAccountId() { _w('resolveDefaultLineAccountId'); return undefined; }
export function resolveLineAccount() { _w('resolveLineAccount'); return undefined; }
export const LineConfigSchema = undefined;
export function createActionCard() { _w('createActionCard'); return undefined; }
export function createAgendaCard() { _w('createAgendaCard'); return undefined; }
export function createAppleTvRemoteCard() { _w('createAppleTvRemoteCard'); return undefined; }
export function createDeviceControlCard() { _w('createDeviceControlCard'); return undefined; }
export function createEventCard() { _w('createEventCard'); return undefined; }
export function createImageCard() { _w('createImageCard'); return undefined; }
export function createInfoCard() { _w('createInfoCard'); return undefined; }
export function createListCard() { _w('createListCard'); return undefined; }
export function createMediaPlayerCard() { _w('createMediaPlayerCard'); return undefined; }
export function createReceiptCard() { _w('createReceiptCard'); return undefined; }
export function processLineMessage() { _w('processLineMessage'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/channel-setup.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/channel-setup.' + fn + '() not implemented in Bridge mode'); }
}

export function createOptionalChannelSetupSurface() { _w('createOptionalChannelSetupSurface'); return undefined; }
export const DEFAULT_ACCOUNT_ID = undefined;
export function createTopLevelChannelDmPolicy() { _w('createTopLevelChannelDmPolicy'); return undefined; }
export function formatDocsLink() { _w('formatDocsLink'); return ""; }
export function setSetupChannelEnabled() { _w('setSetupChannelEnabled'); return undefined; }
export function splitSetupEntries() { _w('splitSetupEntries'); return undefined; }
export function createOptionalChannelSetupAdapter() { _w('createOptionalChannelSetupAdapter'); return undefined; }
export function createOptionalChannelSetupWizard() { _w('createOptionalChannelSetupWizard'); return undefined; }

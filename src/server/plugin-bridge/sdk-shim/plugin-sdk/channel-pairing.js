// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/channel-pairing.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/channel-pairing.' + fn + '() not implemented in Bridge mode'); }
}

export function createChannelPairingChallengeIssuer() { _w('createChannelPairingChallengeIssuer'); return undefined; }
export function createChannelPairingController() { _w('createChannelPairingController'); return undefined; }
export function createLoggedPairingApprovalNotifier() { _w('createLoggedPairingApprovalNotifier'); return undefined; }
export function createPairingPrefixStripper() { _w('createPairingPrefixStripper'); return undefined; }
export function createTextPairingAdapter() { _w('createTextPairingAdapter'); return undefined; }
export function readChannelAllowFromStore() { _w('readChannelAllowFromStore'); return undefined; }
export function readChannelAllowFromStoreSync() { _w('readChannelAllowFromStoreSync'); return undefined; }
export function resolveChannelAllowFromPath() { _w('resolveChannelAllowFromPath'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/device-bootstrap.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/device-bootstrap.' + fn + '() not implemented in Bridge mode'); }
}

export function approveDevicePairing() { _w('approveDevicePairing'); return undefined; }
export function listDevicePairing() { _w('listDevicePairing'); return []; }
export function clearDeviceBootstrapTokens() { _w('clearDeviceBootstrapTokens'); return undefined; }
export function issueDeviceBootstrapToken() { _w('issueDeviceBootstrapToken'); return undefined; }
export function revokeDeviceBootstrapToken() { _w('revokeDeviceBootstrapToken'); return undefined; }
export function normalizeDeviceBootstrapProfile() { _w('normalizeDeviceBootstrapProfile'); return ""; }
export const PAIRING_SETUP_BOOTSTRAP_PROFILE = undefined;

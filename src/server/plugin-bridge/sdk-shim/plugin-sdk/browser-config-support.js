// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-config-support.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-config-support.' + fn + '() not implemented in Bridge mode'); }
}

export function resolveGatewayPort() { _w('resolveGatewayPort'); return undefined; }
export const DEFAULT_BROWSER_CONTROL_PORT = undefined;
export function deriveDefaultBrowserCdpPortRange() { _w('deriveDefaultBrowserCdpPortRange'); return undefined; }
export function deriveDefaultBrowserControlPort() { _w('deriveDefaultBrowserControlPort'); return undefined; }
export function isLoopbackHost() { _w('isLoopbackHost'); return false; }
export const CONFIG_DIR = undefined;
export function escapeRegExp() { _w('escapeRegExp'); return undefined; }
export function resolveUserPath() { _w('resolveUserPath'); return undefined; }
export function shortenHomePath() { _w('shortenHomePath'); return undefined; }

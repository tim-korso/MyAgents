// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-config-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-config-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function createConfigIO() { _w('createConfigIO'); return undefined; }
export function getRuntimeConfigSnapshot() { _w('getRuntimeConfigSnapshot'); return undefined; }
export const loadConfig = undefined;
export function writeConfigFile() { _w('writeConfigFile'); return undefined; }
export function resolveConfigPath() { _w('resolveConfigPath'); return undefined; }
export function resolveGatewayPort() { _w('resolveGatewayPort'); return undefined; }
export const DEFAULT_BROWSER_CONTROL_PORT = undefined;
export function deriveDefaultBrowserCdpPortRange() { _w('deriveDefaultBrowserCdpPortRange'); return undefined; }
export function deriveDefaultBrowserControlPort() { _w('deriveDefaultBrowserControlPort'); return undefined; }
export const normalizePluginsConfig = undefined;
export function resolveEffectiveEnableState() { _w('resolveEffectiveEnableState'); return undefined; }
export function parseBooleanValue() { _w('parseBooleanValue'); return undefined; }
export const CONFIG_DIR = undefined;
export function escapeRegExp() { _w('escapeRegExp'); return undefined; }
export function resolveUserPath() { _w('resolveUserPath'); return undefined; }
export function shortenHomePath() { _w('shortenHomePath'); return undefined; }

// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/browser-node-runtime.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/browser-node-runtime.' + fn + '() not implemented in Bridge mode'); }
}

export function addGatewayClientOptions() { _w('addGatewayClientOptions'); return undefined; }
export function callGatewayFromCli() { _w('callGatewayFromCli'); return undefined; }
export function runCommandWithRuntime() { _w('runCommandWithRuntime'); return undefined; }
export function resolveGatewayAuth() { _w('resolveGatewayAuth'); return undefined; }
export function isLoopbackHost() { _w('isLoopbackHost'); return false; }
export function isNodeCommandAllowed() { _w('isNodeCommandAllowed'); return false; }
export function resolveNodeCommandAllowlist() { _w('resolveNodeCommandAllowlist'); return undefined; }
export function ErrorCodes() { _w('ErrorCodes'); return undefined; }
export function errorShape() { _w('errorShape'); return undefined; }
export function respondUnavailableOnNodeInvokeError() { _w('respondUnavailableOnNodeInvokeError'); return undefined; }
export function safeParseJson() { _w('safeParseJson'); return undefined; }
export function ensureGatewayStartupAuth() { _w('ensureGatewayStartupAuth'); return undefined; }
export function rawDataToString() { _w('rawDataToString'); return undefined; }
export function startLazyPluginServiceModule() { _w('startLazyPluginServiceModule'); return undefined; }
export function runExec() { _w('runExec'); return undefined; }
export function defaultRuntime() { _w('defaultRuntime'); return undefined; }
export function withTimeout() { _w('withTimeout'); return undefined; }

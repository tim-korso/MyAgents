// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/twitch.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/twitch.' + fn + '() not implemented in Bridge mode'); }
}

export const twitchSetupAdapter = undefined;
export const twitchSetupWizard = undefined;
export const buildChannelConfigSchema = undefined;
export function createChannelReplyPipeline() { _w('createChannelReplyPipeline'); return undefined; }
export const MarkdownConfigSchema = undefined;
export const DEFAULT_ACCOUNT_ID = undefined;
export function normalizeAccountId() { _w('normalizeAccountId'); return ""; }
export const emptyPluginConfigSchema = undefined;
export function formatDocsLink() { _w('formatDocsLink'); return ""; }

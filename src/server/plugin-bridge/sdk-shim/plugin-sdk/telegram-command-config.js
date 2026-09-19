// AUTO-GENERATED STUB — do not edit manually.
// Regenerate: npm run generate:sdk-shims
// Source: openclaw/src/plugin-sdk/telegram-command-config.ts

const _warned = new Set();
function _w(fn) {
  if (!_warned.has(fn)) { _warned.add(fn); console.warn('[sdk-shim] openclaw/plugin-sdk/telegram-command-config.' + fn + '() not implemented in Bridge mode'); }
}

export function getTelegramCommandNamePattern() { _w('getTelegramCommandNamePattern'); return undefined; }
export function normalizeTelegramCommandName() { _w('normalizeTelegramCommandName'); return ""; }
export function normalizeTelegramCommandDescription() { _w('normalizeTelegramCommandDescription'); return ""; }
export function resolveTelegramCustomCommands() { _w('resolveTelegramCustomCommands'); return undefined; }
export const TELEGRAM_COMMAND_NAME_PATTERN = undefined;

import type { AppConfig } from './types';
import { normalizeProxyScope } from '../../shared/proxyScope';

/** Replace the editable subset while keeping hidden entries in their old slots. */
function mergeHiddenIds(previous: string[] | undefined, next: string[] | undefined, hidden: Set<string>): string[] {
  const visible = [...new Set((next ?? []).filter(id => !hidden.has(id)))];
  const merged: string[] = [];
  let index = 0;
  for (const id of previous ?? []) {
    if (hidden.has(id)) {
      if (!merged.includes(id)) merged.push(id);
    } else if (index < visible.length) {
      merged.push(visible[index++]);
    }
  }
  return [...merged, ...visible.slice(index)];
}

/** Called inside the existing config lock against disk-latest state. A UI's
 * platform-filtered list has no authority to delete preferences it cannot edit. */
export function preserveHiddenProviderSettings(
  current: AppConfig,
  updates: Partial<AppConfig>,
  hiddenIds: readonly string[],
): Partial<AppConfig> {
  if (hiddenIds.length === 0) return updates;
  const hidden = new Set(hiddenIds);
  const merged = { ...updates };
  if ('providerOrder' in updates) {
    merged.providerOrder = mergeHiddenIds(current.providerOrder, updates.providerOrder, hidden);
  }
  if ('disabledProviderIds' in updates) {
    const ids = mergeHiddenIds(current.disabledProviderIds, updates.disabledProviderIds, hidden);
    merged.disabledProviderIds = ids.length ? ids : undefined;
  }
  if (updates.proxySettings?.scope?.mode === 'custom') {
    const previous = normalizeProxyScope(current.proxySettings?.scope);
    const next = normalizeProxyScope(updates.proxySettings.scope);
    merged.proxySettings = { ...updates.proxySettings, scope: {
      ...next,
      providerIds: mergeHiddenIds(previous.mode === 'all' ? [...hiddenIds] : previous.providerIds,
        next.providerIds, hidden),
    } };
  }
  return merged;
}

import type { RuntimeModelInfo } from '../../shared/types/runtime';
import { normalizeReasoningEffort, reasoningEffortAfterModelChange } from '../../shared/reasoningEffort';

type ModelRpc = { call(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> };

/** Read the native catalog, including pagination. Never maintain effort enums here. */
export async function readCodexModels(rpc: ModelRpc): Promise<RuntimeModelInfo[]> {
  const models: RuntimeModelInfo[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await rpc.call('model/list', { includeHidden: false, ...(cursor ? { cursor } : {}) }, 10_000) as {
      data: Array<{
        id: string; model?: string; displayName?: string; description?: string;
        hidden?: boolean; isDefault?: boolean;
        supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
        defaultReasoningEffort?: string;
      }>;
      nextCursor?: string | null;
    };
    for (const model of result.data) {
      if (model.hidden) continue;
      models.push({
        value: model.model || model.id,
        displayName: model.displayName || model.id,
        description: model.description,
        isDefault: model.isDefault,
        supportedReasoningEfforts: model.supportedReasoningEfforts,
        defaultReasoningEffort: model.defaultReasoningEffort,
      });
    }
    cursor = result.nextCursor || undefined;
    if (cursor && cursors.has(cursor)) throw new Error('Codex returned a repeated model catalog cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return models;
}

/** Resolve execution from this process's catalog without changing saved intent. */
export function resolveManagedCodexEffort(
  models: readonly RuntimeModelInfo[], model: string, effort: string,
): string | undefined {
  const capabilities = model
    ? models.find(item => item.value === model)
    : models.find(item => item.isDefault);
  const selected = normalizeReasoningEffort(reasoningEffortAfterModelChange(effort, capabilities));
  if (selected) return selected;
  if (capabilities?.defaultReasoningEffort) return capabilities.defaultReasoningEffort;
  // Omitting effort keeps the previous turn's override, so it cannot implement
  // "model default". Leave saved intent intact and surface missing authority.
  throw new Error(`Codex has not provided a default reasoning effort for ${model || 'the default model'}. Refresh the model list or select an explicit effort.`);
}

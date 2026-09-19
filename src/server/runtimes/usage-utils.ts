import type { RuntimeType } from '../../shared/types/runtime';
import type { MessageUsage, ModelUsageEntry, SessionMessage } from '../types/session';

function cloneModelUsage(
  modelUsage?: Record<string, ModelUsageEntry>,
): Record<string, ModelUsageEntry> | undefined {
  if (!modelUsage) return undefined;
  const cloned: Record<string, ModelUsageEntry> = {};
  for (const [model, stats] of Object.entries(modelUsage)) {
    cloned[model] = {
      inputTokens: stats.inputTokens ?? 0,
      outputTokens: stats.outputTokens ?? 0,
      cacheReadTokens: stats.cacheReadTokens || undefined,
      cacheCreationTokens: stats.cacheCreationTokens || undefined,
    };
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

export function getPrimaryModel(
  modelUsage?: Record<string, ModelUsageEntry>,
): string | undefined {
  if (!modelUsage) return undefined;

  let primaryModel: string | undefined;
  let maxTokens = -1;
  for (const [model, stats] of Object.entries(modelUsage)) {
    const total = (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0);
    if (total > maxTokens) {
      maxTokens = total;
      primaryModel = model;
    }
  }
  return primaryModel;
}

export function normalizeUsage(
  usage?: Partial<MessageUsage> | null,
): MessageUsage | null {
  if (!usage) return null;

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationTokens ?? 0;
  const modelUsage = cloneModelUsage(usage.modelUsage);
  const model = usage.model ?? getPrimaryModel(modelUsage);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens || undefined,
    cacheCreationTokens: cacheCreationTokens || undefined,
    model,
    modelUsage,
  };
}

export function addUsageTotals(
  base?: Partial<MessageUsage> | null,
  delta?: Partial<MessageUsage> | null,
): MessageUsage | null {
  const normalizedBase = normalizeUsage(base);
  const normalizedDelta = normalizeUsage(delta);
  if (!normalizedBase && !normalizedDelta) return null;

  const mergedModelUsage: Record<string, ModelUsageEntry> = {};

  for (const source of [normalizedBase?.modelUsage, normalizedDelta?.modelUsage]) {
    if (!source) continue;
    for (const [model, stats] of Object.entries(source)) {
      const existing = mergedModelUsage[model] ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      mergedModelUsage[model] = {
        inputTokens: existing.inputTokens + (stats.inputTokens ?? 0),
        outputTokens: existing.outputTokens + (stats.outputTokens ?? 0),
        cacheReadTokens: ((existing.cacheReadTokens ?? 0) + (stats.cacheReadTokens ?? 0)) || undefined,
        cacheCreationTokens: ((existing.cacheCreationTokens ?? 0) + (stats.cacheCreationTokens ?? 0)) || undefined,
      };
    }
  }

  const modelUsage = Object.keys(mergedModelUsage).length > 0 ? mergedModelUsage : undefined;
  const model = normalizedDelta?.model
    ?? normalizedBase?.model
    ?? getPrimaryModel(modelUsage);

  return {
    inputTokens: (normalizedBase?.inputTokens ?? 0) + (normalizedDelta?.inputTokens ?? 0),
    outputTokens: (normalizedBase?.outputTokens ?? 0) + (normalizedDelta?.outputTokens ?? 0),
    cacheReadTokens: ((normalizedBase?.cacheReadTokens ?? 0) + (normalizedDelta?.cacheReadTokens ?? 0)) || undefined,
    cacheCreationTokens: ((normalizedBase?.cacheCreationTokens ?? 0) + (normalizedDelta?.cacheCreationTokens ?? 0)) || undefined,
    model,
    modelUsage,
  };
}

export function diffUsageTotals(
  previousTotals: Partial<MessageUsage> | null | undefined,
  nextTotals: Partial<MessageUsage> | null | undefined,
): MessageUsage | null {
  const previous = normalizeUsage(previousTotals);
  const next = normalizeUsage(nextTotals);
  if (!next) return null;

  const deltaModelUsage: Record<string, ModelUsageEntry> = {};
  const modelKeys = new Set<string>([
    ...Object.keys(previous?.modelUsage ?? {}),
    ...Object.keys(next.modelUsage ?? {}),
  ]);

  for (const model of modelKeys) {
    const prevStats = previous?.modelUsage?.[model];
    const nextStats = next.modelUsage?.[model];
    if (!nextStats) continue;

    const inputTokens = Math.max(0, (nextStats.inputTokens ?? 0) - (prevStats?.inputTokens ?? 0));
    const outputTokens = Math.max(0, (nextStats.outputTokens ?? 0) - (prevStats?.outputTokens ?? 0));
    const cacheReadTokens = Math.max(0, (nextStats.cacheReadTokens ?? 0) - (prevStats?.cacheReadTokens ?? 0));
    const cacheCreationTokens = Math.max(0, (nextStats.cacheCreationTokens ?? 0) - (prevStats?.cacheCreationTokens ?? 0));

    if (inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheCreationTokens > 0) {
      deltaModelUsage[model] = {
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheReadTokens || undefined,
        cacheCreationTokens: cacheCreationTokens || undefined,
      };
    }
  }

  const modelUsage = Object.keys(deltaModelUsage).length > 0 ? deltaModelUsage : undefined;
  const model = next.model ?? getPrimaryModel(modelUsage) ?? previous?.model;

  return {
    inputTokens: Math.max(0, next.inputTokens - (previous?.inputTokens ?? 0)),
    outputTokens: Math.max(0, next.outputTokens - (previous?.outputTokens ?? 0)),
    cacheReadTokens: Math.max(0, (next.cacheReadTokens ?? 0) - (previous?.cacheReadTokens ?? 0)) || undefined,
    cacheCreationTokens: Math.max(0, (next.cacheCreationTokens ?? 0) - (previous?.cacheCreationTokens ?? 0)) || undefined,
    model,
    modelUsage,
  };
}

export function restoreRuntimeUsageTotals(
  runtimeType: RuntimeType,
  messages: SessionMessage[],
  persistedTotals?: Partial<MessageUsage> | null,
): MessageUsage | null {
  const normalizedPersisted = normalizeUsage(persistedTotals);
  if (normalizedPersisted) return normalizedPersisted;

  const assistantUsages = messages
    .filter((msg) => msg.role === 'assistant' && msg.usage)
    .map((msg) => normalizeUsage(msg.usage))
    .filter((usage): usage is MessageUsage => usage !== null);

  if (assistantUsages.length === 0) return null;

  // Backward compatibility:
  // historical Codex sessions persisted thread-level running totals per turn.
  // For those sessions, the most recent assistant usage is the best available baseline.
  if (runtimeType === 'codex') {
    return assistantUsages[assistantUsages.length - 1] ?? null;
  }

  return assistantUsages.reduce<MessageUsage | null>((acc, usage) => addUsageTotals(acc, usage), null);
}

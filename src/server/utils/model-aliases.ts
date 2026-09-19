export type ModelAliases = {
  fable?: string;
  sonnet?: string;
  opus?: string;
  haiku?: string;
};

/**
 * Third-party provider aliases serve two different purposes:
 *
 * - Split tables (`fable`/`sonnet`/`opus`/`haiku` point at different models) are an
 *   intentional routing policy and must be preserved.
 * - Collapsed tables (all aliases point at the same model) are just a
 *   safety net to stop SDK built-in subagents from leaking raw Claude model IDs
 *   to third-party providers. In that case the active session model is the
 *   user's real choice and should drive SDK aliases too.
 */
export function resolveSessionModelAliases(
  aliases: ModelAliases | undefined,
  activeModel: string | undefined | null,
): ModelAliases | undefined {
  const normalized = completeFableAlias(aliases);
  const model = activeModel?.trim();
  if (!normalized || !model) return normalized;
  if (!normalized.fable || !normalized.sonnet || !normalized.opus || !normalized.haiku) return normalized;
  if (
    normalized.fable !== normalized.opus
    || normalized.opus !== normalized.sonnet
    || normalized.sonnet !== normalized.haiku
  ) return normalized;
  if (normalized.haiku === model) return normalized;
  return { fable: model, sonnet: model, opus: model, haiku: model };
}

function completeFableAlias(aliases: ModelAliases | undefined): ModelAliases | undefined {
  if (!aliases) return undefined;
  if (aliases.fable !== undefined) return aliases;
  const fallback = aliases.opus ?? aliases.sonnet ?? aliases.haiku;
  return fallback ? { ...aliases, fable: fallback } : aliases;
}

function modelAliasesEqual(a: ModelAliases | undefined, b: ModelAliases | undefined): boolean {
  return (a?.fable ?? undefined) === (b?.fable ?? undefined)
    && (a?.sonnet ?? undefined) === (b?.sonnet ?? undefined)
    && (a?.opus ?? undefined) === (b?.opus ?? undefined)
    && (a?.haiku ?? undefined) === (b?.haiku ?? undefined);
}

export function modelAliasEnvChangesForModel(
  aliases: ModelAliases | undefined,
  oldModel: string | undefined,
  newModel: string | undefined,
): boolean {
  return !modelAliasesEqual(
    resolveSessionModelAliases(aliases, oldModel),
    resolveSessionModelAliases(aliases, newModel),
  );
}

/**
 * Pure logic for the per-model settings editor (#325) — extracted from
 * ModelManagementPanel so parsing / save-shape decisions are unit-testable.
 *
 * Editable fields and WHY only these (consumption-chain audit, 2026-06-10):
 *  - `contextLength`     feeds CLAUDE_CODE_AUTO_COMPACT_WINDOW, the [1m] SDK
 *                        suffix and the context-usage ring denominator.
 *  - `inputModalities`   feeds sidecar attachment stripping + the renderer's
 *                        image-attach gating (modelSupportsModality).
 *  - `modelName`         display name everywhere (manual adds default to id).
 * Model-level `maxOutputTokens` is deliberately EXCLUDED: the registry stores
 * it but nothing consumes it — the effective knob is provider-level
 * `ProviderEnv.maxOutputTokens` (wire request param), configured on the
 * provider. Surfacing a dead model-level field would be a lying knob.
 */

/** Modality kinds offered in the editor. `text` is default-checked; the user
 *  picks the rest. At least one must remain selected (validated by caller via
 *  `isModalitySelectionValid`). */
export const EDITABLE_MODALITIES = ['text', 'image', 'video', 'audio'] as const;
export type EditableModality = (typeof EDITABLE_MODALITIES)[number];

/** Upper sanity bound for a context window. MUST match the sidecar registry's
 *  `MAX_PLAUSIBLE_TOKENS` (src/server/utils/model-capabilities.ts) — the
 *  registry silently drops values above its cap, so accepting a larger number
 *  here would save a value the runtime then ignores (codex review). */
const MAX_CONTEXT_WINDOW = 20_000_000;

/**
 * Parse the context-window input. Accepts:
 *   ''        → null   (clear the override — fall back to registry/default)
 *   '128000'  → 128000
 *   '128k'    → 128_000      (case-insensitive, decimal allowed: '1.5k' → 1500)
 *   '1m'      → 1_000_000
 * Returns 'invalid' for anything that doesn't resolve to a positive integer
 * within (0, 20M] (see MAX_CONTEXT_WINDOW above).
 */
export function parseContextWindowInput(raw: string): number | null | 'invalid' {
  const input = raw.trim();
  if (input === '') return null;
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(input);
  if (!match) return 'invalid';
  const base = Number(match[1]);
  const multiplier = match[2] ? (match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1;
  const value = base * multiplier;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CONTEXT_WINDOW) return 'invalid';
  return value;
}

/** At least one modality must be selected. */
export function isModalitySelectionValid(selected: readonly string[]): boolean {
  return selected.length > 0;
}

/** Initial toggle state for the editor: previously stored modalities, or the
 *  default "text checked" when the model has none recorded. */
export function initialModalitySelection(prev: readonly string[] | undefined): EditableModality[] {
  if (prev && prev.length > 0) {
    return EDITABLE_MODALITIES.filter((m) => prev.includes(m));
  }
  return ['text'];
}

/**
 * True when `modelId` is one of the app's hand-curated bundled models for a
 * builtin (preset) provider.
 *
 * Why this gate exists (cross-review 0.2.32, codex): re-adding a previously
 * REMOVED bundled preset from the discovery list must only delete it from
 * `presetRemovedModels` — it must NOT also append a discovered copy into
 * `presetCustomModels`. Discovery metadata is lower-trust than the app's
 * curated preset data and should not override it.
 *
 * Manual custom-model entry is a different path: when the user typed the
 * bundled id and explicitly saved settings, the persisted entry is
 * `source: 'manual'` and is treated as a user override by both renderer merge
 * and sidecar capability lookup.
 */
export function isBundledPresetModelId(
  bundledModelIds: ReadonlySet<string>,
  modelId: string,
): boolean {
  return bundledModelIds.has(modelId);
}

/**
 * Decide what `handleAddDiscoveredModel` should write for a builtin provider.
 *  - bundled id  → un-remove only (the curated preset resurfaces by itself)
 *  - custom id   → un-remove + append to presetCustomModels (today's behavior)
 */
export function discoveredModelWritePlan(
  bundledModelIds: ReadonlySet<string>,
  modelId: string,
): { unremove: true; appendToCustomModels: boolean } {
  return {
    unremove: true,
    appendToCustomModels: !isBundledPresetModelId(bundledModelIds, modelId),
  };
}

/**
 * Decide what to persist for `inputModalities`.
 *
 * Pit-of-success: an UNSET `inputModalities` means "optimistic default-allow"
 * (both sidecar `modelSupportsModality` and the renderer mirror treat unknown
 * as allow-all). If the user opens the editor but never touches the toggles,
 * saving must NOT silently narrow an unset model down to `['text']` — keep it
 * unset. Once the user touches the toggles (or the model already had an
 * explicit list), persist the explicit selection.
 *
 * The modality value space is OPEN (registry `coerceModalities` accepts any
 * short lowercase token; LiteLLM commonly records `pdf` / `document`). The
 * editor only renders the four EDITABLE_MODALITIES toggles, so any other
 * stored modality is invisible here — it must be PRESERVED on save, not
 * replaced away, or saving the editor silently revokes attachment types the
 * model legitimately supports (cross-review 0.2.33, cc data-loss finding:
 * `['text','pdf']` + toggle image → saved as `['text','image']`, sidecar
 * `modelSupportsModality` starts rejecting PDFs).
 */
export function resolveModalitiesToSave(
  touched: boolean,
  prev: readonly string[] | undefined,
  selected: readonly EditableModality[],
): string[] | undefined {
  if (!touched && (!prev || prev.length === 0)) return undefined;
  const extras = (prev ?? []).filter(
    (m) => !(EDITABLE_MODALITIES as readonly string[]).includes(m),
  );
  return [...selected, ...extras];
}

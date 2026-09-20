import type { Provider } from '../types';

/**
 * Provider files are written by several entry points (the UI form, imports, and
 * hand-edited JSON), and the on-disk shape is not enforced when a file is read.
 * A file that puts `baseUrl` / `authType` / `apiProtocol` at the top level is
 * structurally a valid configuration but fails the `config`-shaped check, and
 * the read path skips it with only a console warning — the provider silently
 * disappears from the UI.
 *
 * Normalize the flat form into the nested one instead of rejecting it, so an
 * otherwise usable provider keeps working. Unknown/absent fields are left unset
 * and filled by the existing defaults downstream, so this only ever moves
 * recognised API settings into their canonical place.
 */
export interface NormalizedProviderFile {
  provider: Provider;
  /** True when the flat layout was folded into `config`. */
  migrated: boolean;
}

const FLAT_CONFIG_KEYS = ['baseUrl', 'timeout', 'disableNonessential'] as const;

export function normalizeProviderFile(parsed: unknown): NormalizedProviderFile | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as Record<string, unknown>;

  if (!raw.id || !raw.name || !Array.isArray(raw.models)) return null;
  if (raw.config && typeof raw.config === 'object') {
    return { provider: raw as unknown as Provider, migrated: false };
  }

  const config: Record<string, unknown> = {};
  let migrated = false;
  for (const key of FLAT_CONFIG_KEYS) {
    if (raw[key] !== undefined) {
      config[key] = raw[key];
      migrated = true;
    }
  }
  if (!migrated) return null;

  const provider = { ...raw, config } as unknown as Provider;
  const mutableProvider = provider as unknown as Record<string, unknown>;
  for (const key of FLAT_CONFIG_KEYS) delete mutableProvider[key];

  // A provider without these three cannot render as a card; the nested files
  // always carry them, so supply the same neutral values rather than dropping
  // the provider after migrating it.
  if (!provider.vendor) provider.vendor = String(raw.name);
  if (!provider.cloudProvider) provider.cloudProvider = '自定义';
  if (provider.type !== 'subscription' && provider.type !== 'api') provider.type = 'api';
  if (typeof provider.isBuiltin !== 'boolean') provider.isBuiltin = false;

  return { provider, migrated: true };
}

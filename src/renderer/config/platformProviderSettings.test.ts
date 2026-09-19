import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, PROXY_DEFAULTS, type AppConfig } from './types';
import { preserveHiddenProviderSettings } from './platformProviderSettings';

const hidden = ['codex-sub', 'antigravity-sub'];
describe('platform-hidden provider preferences', () => {
  it('edits only visible order and enabled state, retaining hidden slots and disabled intent', () => {
    const current = { ...DEFAULT_CONFIG, providerOrder: ['api-a', 'codex-sub', 'api-b', 'antigravity-sub'],
      disabledProviderIds: ['codex-sub', 'api-b'] };
    const result = preserveHiddenProviderSettings(current, {
      providerOrder: ['api-b', 'api-a'], disabledProviderIds: undefined,
    }, hidden);
    expect(result.providerOrder).toEqual(['api-b', 'codex-sub', 'api-a', 'antigravity-sub']);
    expect(result.disabledProviderIds).toEqual(['codex-sub']);
    expect(current.disabledProviderIds).toEqual(['codex-sub', 'api-b']);
  });

  it.each(['custom', 'all'] as const)('retains hidden proxy membership when editing a %s scope', mode => {
    const current: AppConfig = { ...DEFAULT_CONFIG, proxySettings: { ...PROXY_DEFAULTS, enabled: true,
      scope: mode === 'all' ? { mode } : { mode, generalRequests: false, providerIds: ['codex-sub', 'api-b'] } } };
    const result = preserveHiddenProviderSettings(current, { proxySettings: { ...PROXY_DEFAULTS, enabled: true,
      scope: { mode: 'custom', generalRequests: true, providerIds: ['api-a'] } } }, hidden);
    expect(result.proxySettings?.scope?.providerIds).toContain('codex-sub');
    expect(result.proxySettings?.scope?.providerIds).not.toContain('api-b');
    expect(result.proxySettings?.scope?.providerIds).toContain('api-a');
    expect(result.proxySettings?.scope?.providerIds?.includes('antigravity-sub')).toBe(mode === 'all');
    expect(result.proxySettings?.scope?.generalRequests).toBe(true);
  });

  it('does not change patches on supported platforms or unrelated config fields', () => {
    const updates = { providerOrder: ['api-a'], disabledProviderIds: undefined };
    expect(preserveHiddenProviderSettings(DEFAULT_CONFIG, updates, [])).toBe(updates);
    expect(preserveHiddenProviderSettings(DEFAULT_CONFIG, { showDevTools: true }, hidden)).toEqual({ showDevTools: true });
  });
});

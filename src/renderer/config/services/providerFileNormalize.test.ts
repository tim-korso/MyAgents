import { describe, expect, it } from 'vitest';

import { normalizeProviderFile } from './providerFileNormalize';

/** The flat layout observed in a real user provider file. */
function flatProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deepseek-tp',
    name: 'DeepSeek Token Plan',
    primaryModel: 'deepseek-v4-flash-0731',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    authType: 'api_key',
    apiProtocol: 'openai',
    models: [{ model: 'deepseek-v4-pro', modelName: 'DeepSeek V4 Pro' }],
    ...overrides,
  };
}

function nestedProvider() {
  return {
    id: 'qianfan-token-plan',
    name: '千帆 Token Plan',
    vendor: 'Baidu Qianfan',
    cloudProvider: '自定义',
    type: 'api',
    primaryModel: 'kimi-k2.6',
    isBuiltin: false,
    config: { baseUrl: 'https://qianfan.baidubce.com/anthropic/tokenplan/personal' },
    models: [{ model: 'kimi-k2.6', modelName: 'Kimi K2.6' }],
  };
}

describe('normalizeProviderFile', () => {
  it('folds top-level API settings into config instead of rejecting the file', () => {
    const result = normalizeProviderFile(flatProvider());
    expect(result).not.toBeNull();
    expect(result!.migrated).toBe(true);
    expect(result!.provider.config.baseUrl)
      .toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
    // The flat keys must not survive alongside their nested copy.
    expect((result!.provider as unknown as Record<string, unknown>).baseUrl).toBeUndefined();
  });

  it('preserves the fields the provider card needs', () => {
    const { provider } = normalizeProviderFile(flatProvider())!;
    expect(provider.id).toBe('deepseek-tp');
    expect(provider.name).toBe('DeepSeek Token Plan');
    expect(provider.primaryModel).toBe('deepseek-v4-flash-0731');
    expect(provider.apiProtocol).toBe('openai');
    expect(provider.authType).toBe('api_key');
    expect(provider.models).toHaveLength(1);
    // Filled defaults rather than dropped provider.
    expect(provider.vendor).toBe('DeepSeek Token Plan');
    expect(provider.cloudProvider).toBe('自定义');
    expect(provider.type).toBe('api');
    expect(provider.isBuiltin).toBe(false);
  });

  it('leaves an already-nested provider untouched', () => {
    const input = nestedProvider();
    const result = normalizeProviderFile(input);
    expect(result).not.toBeNull();
    expect(result!.migrated).toBe(false);
    expect(result!.provider).toBe(input);
  });

  it('still rejects files that carry no usable API settings', () => {
    expect(normalizeProviderFile({ id: 'x', name: 'X', models: [] })).toBeNull();
    expect(normalizeProviderFile(null)).toBeNull();
    expect(normalizeProviderFile('nope')).toBeNull();
    expect(normalizeProviderFile({ name: 'X', config: {}, models: [] })).toBeNull();
  });

  it('does not treat an unrelated nested object as config', () => {
    // `config: null` must not pass for a present config; the flat migration
    // path is the one that should pick these settings up.
    const result = normalizeProviderFile(flatProvider({ config: null }));
    expect(result?.migrated).toBe(true);
    expect(result?.provider.config.baseUrl).toContain('token-plan');
  });
});

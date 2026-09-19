import { describe, expect, it } from 'vitest';

import { MANAGED_CODEX_PROVIDER, type Provider } from '@/config/types';
import { projectTaskExecutionOverrides } from './taskProviderProjection';

function apiProvider(id: string): Pick<Provider, 'id' | 'execution'> {
  return { id };
}

describe('task provider projection', () => {
  it('projects a runtime-backed provider into runtime initialization fields', () => {
    expect(projectTaskExecutionOverrides({
      providers: [MANAGED_CODEX_PROVIDER],
      runtime: 'builtin',
      providerId: 'codex-sub',
      model: 'gpt-5.5-codex',
      runtimeConfig: { envPolicy: { proxy: 'terminal' } },
    })).toEqual({
      runtime: 'codex',
      providerId: undefined,
      model: undefined,
      runtimeConfig: {
        source: 'managed-provider',
        model: 'gpt-5.5-codex',
        envPolicy: { proxy: 'terminal' },
      },
    });
  });

  it('keeps an API provider as provider identity without credential material', () => {
    expect(projectTaskExecutionOverrides({
      providers: [apiProvider('openrouter')],
      runtime: 'builtin',
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
    })).toEqual({
      runtime: 'builtin',
      providerId: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      runtimeConfig: undefined,
    });
  });
});

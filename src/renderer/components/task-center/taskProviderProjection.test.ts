import { describe, expect, it } from 'vitest';

import { MANAGED_CODEX_PROVIDER, type Provider } from '@/config/types';
import { projectTaskExecutionOverrides } from './taskProviderProjection';

function apiProvider(id: string): Pick<Provider, 'id' | 'execution'> {
  return { id };
}

describe('projectTaskExecutionOverrides', () => {
  it('keeps ordinary providers as builtin provider/model overrides', () => {
    expect(projectTaskExecutionOverrides({
      providers: [apiProvider('deepseek')],
      providerId: 'deepseek',
      model: 'deepseek-v4',
    })).toEqual({
      runtime: undefined,
      providerId: 'deepseek',
      model: 'deepseek-v4',
      runtimeConfig: undefined,
    });
  });

  it('projects Codex subscription provider to managed Codex runtime identity', () => {
    expect(projectTaskExecutionOverrides({
      providers: [MANAGED_CODEX_PROVIDER],
      providerId: 'codex-sub',
      model: 'gpt-5.4-codex',
      runtimeConfig: { envPolicy: { proxy: 'terminal' } },
    })).toEqual({
      runtime: 'codex',
      providerId: undefined,
      model: undefined,
      runtimeConfig: {
        source: 'managed-provider',
        model: 'gpt-5.4-codex',
        envPolicy: { proxy: 'terminal' },
      },
    });
  });
});

import type { Provider } from '@/config/types';
import {
  runtimeConfigForRuntimeBackedProvider,
  toProviderExecutionIntent,
} from '@/../shared/providerExecution';
import type { RuntimeConfig, RuntimeType } from '@/../shared/types/runtime';

export interface TaskExecutionOverrideInput {
  providers: readonly Pick<Provider, 'id' | 'execution'>[];
  runtime?: RuntimeType;
  providerId?: string;
  model?: string;
  runtimeConfig?: RuntimeConfig;
}

export interface TaskExecutionOverrideProjection {
  runtime?: RuntimeType;
  providerId?: string;
  model?: string;
  runtimeConfig?: RuntimeConfig;
}

export function projectTaskExecutionOverrides(
  input: TaskExecutionOverrideInput,
): TaskExecutionOverrideProjection {
  if (input.providerId && input.model) {
    const provider = input.providers.find((candidate) => candidate.id === input.providerId);
    if (provider) {
      const intent = toProviderExecutionIntent(provider, input.model);
      if (intent.kind === 'runtime-backed-provider') {
        return {
          runtime: intent.runtime,
          providerId: undefined,
          model: undefined,
          runtimeConfig: runtimeConfigForRuntimeBackedProvider(intent, input.runtimeConfig),
        };
      }
    }
  }

  return {
    runtime: input.runtime,
    providerId: input.providerId,
    model: input.model,
    runtimeConfig: input.runtimeConfig,
  };
}

import type {
  ApiProtocol,
  ModelAliases,
  Provider,
  ProviderAuthType,
} from '@/config/types';

export function parsePositiveInt(value: string): number | undefined {
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n <= 0 ? undefined : n;
}

export interface CustomProviderForm {
  name: string;
  cloudProvider: string;
  apiProtocol: ApiProtocol;
  baseUrl: string;
  authType: Extract<ProviderAuthType, 'auth_token' | 'api_key'>;
  models: string[];
  newModelInput: string;
  apiKey: string;
  maxOutputTokens: string;
  maxOutputTokensParamName: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';
  upstreamFormat: 'chat_completions' | 'responses';
}

export const EMPTY_CUSTOM_FORM: CustomProviderForm = {
  name: '',
  cloudProvider: '',
  apiProtocol: 'anthropic',
  baseUrl: '',
  authType: 'auth_token',
  models: [],
  newModelInput: '',
  apiKey: '',
  maxOutputTokens: '',
  maxOutputTokensParamName: 'max_tokens',
  upstreamFormat: 'chat_completions',
};

export interface ProviderEditForm {
  provider: Provider;
  customModels: string[];
  removedModels: string[];
  newModelInput: string;
  editName?: string;
  editCloudProvider?: string;
  editApiProtocol?: ApiProtocol;
  editBaseUrl?: string;
  editAuthType?: Extract<ProviderAuthType, 'auth_token' | 'api_key'>;
  editMaxOutputTokens?: string;
  editMaxOutputTokensParamName?: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';
  editUpstreamFormat?: 'chat_completions' | 'responses';
  editModelAliases?: ModelAliases;
  showAdvanced?: boolean;
}

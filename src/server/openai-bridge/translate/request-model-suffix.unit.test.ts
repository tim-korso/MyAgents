import { describe, it, expect } from 'vitest';

import { translateRequest } from './request';
import { translateRequestToResponses } from './request-responses';
import type { AnthropicRequest } from '../types/anthropic';

// #338 — the `[1m]` / ` 1m` context-window suffix is an SDK-ingress decoration
// ONLY. The OpenAI-compatible upstream knows only the bare model id. `req.model`
// arrives already-normalized (the SDK strips `[1m]` via
// normalizeModelStringForAPI), but `modelOverride` / `modelMapping` are fed
// straight from config and can carry a stored `claude-X[1m]` or a hand-typed
// `claude-X 1m` — those must be stripped before the wire, or the upstream
// rejects the model. Both request translators share the contract.
const baseReq: AnthropicRequest = { model: 'claude-sonnet-4-6', messages: [], max_tokens: 1024 };

describe('bridge request model normalization (#338)', () => {
  describe('Chat Completions (translateRequest)', () => {
    it('strips [1m] from modelOverride', () => {
      expect(translateRequest({ ...baseReq }, { modelOverride: 'claude-sonnet-4-6[1m]' }).model).toBe('claude-sonnet-4-6');
    });
    it('strips the malformed " 1m" from modelOverride', () => {
      expect(translateRequest({ ...baseReq }, { modelOverride: 'claude-sonnet-4-6 1m' }).model).toBe('claude-sonnet-4-6');
    });
    it('strips a suffix produced by modelMapping (alias routing)', () => {
      expect(
        translateRequest({ ...baseReq, model: 'sonnet' }, { modelMapping: { sonnet: 'provider-pro[1m]' } }).model,
      ).toBe('provider-pro');
    });
    it('strips a suffix on the req.model fallback', () => {
      expect(translateRequest({ ...baseReq, model: 'foo 1m' }, {}).model).toBe('foo');
    });
    it('leaves a clean model id untouched', () => {
      expect(translateRequest({ ...baseReq, model: 'deepseek-v4-pro' }, {}).model).toBe('deepseek-v4-pro');
    });
  });

  describe('Responses API (translateRequestToResponses)', () => {
    it('strips [1m] / " 1m" from modelOverride', () => {
      expect(translateRequestToResponses({ ...baseReq }, { modelOverride: 'gpt-5.4[1m]' }).model).toBe('gpt-5.4');
      expect(translateRequestToResponses({ ...baseReq }, { modelOverride: 'gpt-5.4 1m' }).model).toBe('gpt-5.4');
    });
    it('strips a suffix produced by modelMapping (alias routing)', () => {
      expect(
        translateRequestToResponses({ ...baseReq, model: 'sonnet' }, { modelMapping: { sonnet: 'gpt-5.4 1m' } }).model,
      ).toBe('gpt-5.4');
    });
    it('strips a suffix on the req.model fallback', () => {
      expect(translateRequestToResponses({ ...baseReq, model: 'gpt-5.4[1m]' }, {}).model).toBe('gpt-5.4');
    });
    it('leaves a clean model id untouched', () => {
      expect(translateRequestToResponses({ ...baseReq, model: 'gpt-5.4' }, {}).model).toBe('gpt-5.4');
    });
  });
});

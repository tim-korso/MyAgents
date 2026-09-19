import { describe, it, expect } from 'vitest';

import { translateRequest } from './request';
import { translateRequestToResponses } from './request-responses';
import type { AnthropicRequest } from '../types/anthropic';

// #324 — reasoning effort is forwarded ONLY when the user explicitly selected
// a non-default value. The default MUST omit the field entirely: many
// OpenAI-compatible providers 400 on unknown request arguments, which is why
// the translators historically never sent reasoning fields at all. These tests
// pin both halves of that contract for both upstream formats.
const baseReq: AnthropicRequest = { model: 'deepseek-v4-flash', messages: [], max_tokens: 1024 };

describe('bridge reasoning effort injection (#324)', () => {
  describe('Chat Completions (translateRequest)', () => {
    it('omits reasoning_effort entirely when not configured (historical wire shape)', () => {
      const out = translateRequest({ ...baseReq }, {});
      expect('reasoning_effort' in out).toBe(false);
    });
    it('injects top-level reasoning_effort when configured', () => {
      expect(translateRequest({ ...baseReq }, { reasoningEffort: 'max' }).reasoning_effort).toBe('max');
    });
    it('passes provider-specific values through verbatim (no vocabulary clamp)', () => {
      expect(translateRequest({ ...baseReq }, { reasoningEffort: 'minimal' }).reasoning_effort).toBe('minimal');
    });
  });

  describe('Responses API (translateRequestToResponses)', () => {
    it('omits the reasoning field entirely when not configured', () => {
      const out = translateRequestToResponses({ ...baseReq }, {});
      expect('reasoning' in out).toBe(false);
    });
    it('injects nested reasoning.effort when configured', () => {
      expect(translateRequestToResponses({ ...baseReq }, { reasoningEffort: 'high' }).reasoning).toEqual({ effort: 'high' });
    });
  });
});

import { describe, expect, it } from 'vitest';

import { shouldSendProviderReasoningEffort } from './handler';

describe('Grok model reasoning effort policy', () => {
  it('allows the Grok 4.6 effort vocabulary including xhigh', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh']) {
      expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.6', effort)).toBe(true);
    }
    for (const effort of ['none', 'minimal', 'max', undefined]) {
      expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.6', effort)).toBe(false);
    }
  });

  it('allows only verified effort values for grok-4.5', () => {
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.5', 'low')).toBe(true);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.5', 'medium')).toBe(true);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.5', 'high')).toBe(true);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.5', 'max')).toBe(false);
  });

  it('allows the verified grok-4.3 set and omits effort for unverified models', () => {
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.3', 'none')).toBe(true);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.3', 'high')).toBe(true);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-build-0.1', 'high')).toBe(false);
    expect(shouldSendProviderReasoningEffort('xai-sub', 'grok-4.20-0309-reasoning', 'high')).toBe(false);
  });

  it('does not constrain non-Grok providers', () => {
    expect(shouldSendProviderReasoningEffort('openai', 'gpt-5.5', 'max')).toBe(true);
    expect(shouldSendProviderReasoningEffort('openai', 'gpt-5.5', undefined)).toBe(false);
  });
});

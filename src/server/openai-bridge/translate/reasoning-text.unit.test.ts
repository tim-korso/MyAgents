import { describe, expect, it } from 'vitest';

import { extractReasoningText } from './reasoning-text';

// DeepSeek sends `reasoning`; most OpenAI-compatible servers send
// `reasoning_content`. Reading only the latter dropped every DeepSeek thinking
// token with no error — the model reasoned and the user saw nothing.
describe('extractReasoningText', () => {
  it('reads the documented reasoning_content field', () => {
    expect(extractReasoningText({ reasoning_content: 'thinking' })).toBe('thinking');
  });

  it("reads DeepSeek's reasoning field", () => {
    // Verified against the live endpoint: the message carries
    // `role, content, reasoning, reasoning_details` and no reasoning_content.
    expect(extractReasoningText({ reasoning: 'deepseek thinking' })).toBe('deepseek thinking');
  });

  it('prefers reasoning_content when a payload somehow carries both', () => {
    expect(extractReasoningText({
      reasoning_content: 'documented',
      reasoning: 'vendor',
    })).toBe('documented');
  });

  it('does not double-emit when only structured details are present', () => {
    // `reasoning_details` transcribes the same content; reading it as well would
    // emit every token twice whenever a provider sends both.
    const payload = {
      reasoning: 'the text',
      reasoning_details: [{ type: 'reasoning.text', text: 'the text', index: 0 }],
    };
    expect(extractReasoningText(payload)).toBe('the text');
  });

  it('returns undefined instead of an empty string for absent or empty input', () => {
    // Callers branch on truthiness to decide whether to open a thinking block;
    // an empty string would open one with no content.
    expect(extractReasoningText({})).toBeUndefined();
    expect(extractReasoningText(null)).toBeUndefined();
    expect(extractReasoningText(undefined)).toBeUndefined();
    expect(extractReasoningText({ reasoning_content: '' })).toBeUndefined();
    expect(extractReasoningText({ reasoning: '' })).toBeUndefined();
  });

  it('ignores non-string values rather than stringifying them', () => {
    expect(extractReasoningText({ reasoning: 123 })).toBeUndefined();
    expect(extractReasoningText({ reasoning: { text: 'nested' } })).toBeUndefined();
    expect(extractReasoningText({ reasoning_content: null })).toBeUndefined();
  });

  it('falls through to reasoning when reasoning_content is present but empty', () => {
    // Some servers emit `reasoning_content: ""` on non-thinking chunks while
    // still streaming the real content under `reasoning`.
    expect(extractReasoningText({ reasoning_content: '', reasoning: 'real' })).toBe('real');
  });
});

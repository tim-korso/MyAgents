import { describe, expect, it } from 'vitest';

import {
  isEmptySuccessfulSdkResult,
  isCoalescedTaskNotificationReceipt,
  isSuccessfulCompactControlTurn,
  isRecoveredAssistantMessageError,
  findTurnUsageStampIndex,
  extractTurnUsageFromSdkResult,
} from './sdk-turn-outcome';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

describe('coalesced task notification receipt', () => {
  const receipt = { subtype: 'success', is_error: false, origin: { kind: 'task-notification' },
    num_turns: 0, result: '' };

  it('recognizes only an explicitly attributed zero-work notification receipt', () => {
    expect(isCoalescedTaskNotificationReceipt(receipt as SDKResultMessage)).toBe(true);
    expect(isCoalescedTaskNotificationReceipt({ ...receipt, terminal_reason: 'completed' } as SDKResultMessage)).toBe(true);
  });

  it.each([
    { origin: undefined }, { origin: { kind: 'human' } }, { origin: { kind: 'peer' } },
    { num_turns: 1 }, { result: 'finished' }, { is_error: true },
    { subtype: 'error_during_execution' }, { terminal_reason: 'aborted_tools' },
  ])('retains normal terminal handling for %j', patch => {
    expect(isCoalescedTaskNotificationReceipt({ ...receipt, ...patch } as SDKResultMessage)).toBe(false);
  });
});

describe('isEmptySuccessfulSdkResult', () => {
  it('detects a completed SDK result with no visible output, tools, result text, or output tokens', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: false,
      result: '',
      terminalReason: 'completed',
      hasVisibleOutput: false,
      toolCount: 0,
      outputTokens: 0,
    })).toBe(true);
  });

  it('does not flag successful text output', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: false,
      result: 'hello',
      terminalReason: 'completed',
      hasVisibleOutput: false,
      toolCount: 0,
      outputTokens: 12,
    })).toBe(false);
  });

  it('treats whitespace-only result text as empty', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: false,
      result: '   \n\t',
      terminalReason: 'completed',
      hasVisibleOutput: false,
      toolCount: 0,
      outputTokens: 0,
    })).toBe(true);
  });

  it('does not flag a tool-only turn', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: false,
      result: '',
      terminalReason: 'completed',
      hasVisibleOutput: false,
      toolCount: 1,
      outputTokens: 0,
    })).toBe(false);
  });

  it('does not flag terminal SDK errors', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: true,
      result: '',
      terminalReason: 'completed',
      hasVisibleOutput: false,
      toolCount: 0,
      outputTokens: 0,
    })).toBe(false);
  });

  it('requires the SDK to claim completion', () => {
    expect(isEmptySuccessfulSdkResult({
      isError: false,
      result: '',
      terminalReason: 'model_error',
      hasVisibleOutput: false,
      toolCount: 0,
      outputTokens: 0,
    })).toBe(false);
  });
});

describe('isRecoveredAssistantMessageError', () => {
  it('treats a completed non-error result as recovery from a provisional assistant message error', () => {
    expect(isRecoveredAssistantMessageError({
      hadAssistantMessageError: true,
      isError: false,
      terminalReason: 'completed',
      emptySuccessfulResult: false,
    })).toBe(true);
  });

  it('does not recover terminal result errors', () => {
    expect(isRecoveredAssistantMessageError({
      hadAssistantMessageError: true,
      isError: true,
      terminalReason: 'completed',
      emptySuccessfulResult: false,
    })).toBe(false);
  });

  it('does not recover non-completed terminal reasons', () => {
    expect(isRecoveredAssistantMessageError({
      hadAssistantMessageError: true,
      isError: false,
      terminalReason: 'model_error',
      emptySuccessfulResult: false,
    })).toBe(false);
  });

  it('does not recover an empty successful result', () => {
    expect(isRecoveredAssistantMessageError({
      hadAssistantMessageError: true,
      isError: false,
      terminalReason: 'completed',
      emptySuccessfulResult: true,
    })).toBe(false);
  });
});

describe('isSuccessfulCompactControlTurn', () => {
  it('accepts an empty successful result when SDK status reports compact success', () => {
    expect(isSuccessfulCompactControlTurn({
      emptySuccessfulResult: true,
      compactResult: 'success',
      sawCompactBoundary: false,
    })).toBe(true);
  });

  it('accepts an empty successful result when SDK emits compact_boundary', () => {
    expect(isSuccessfulCompactControlTurn({
      emptySuccessfulResult: true,
      compactResult: null,
      sawCompactBoundary: true,
    })).toBe(true);
  });

  it('does not accept compact failure as a successful control turn', () => {
    expect(isSuccessfulCompactControlTurn({
      emptySuccessfulResult: true,
      compactResult: 'failed',
      sawCompactBoundary: true,
    })).toBe(false);
  });

  it('does not accept non-empty-result turns as compact control turns', () => {
    expect(isSuccessfulCompactControlTurn({
      emptySuccessfulResult: false,
      compactResult: 'success',
      sawCompactBoundary: true,
    })).toBe(false);
  });
});

describe('findTurnUsageStampIndex (#331 — usage must land on the right assistant, not the last element)', () => {
  const u = { role: 'user' as const };
  const a = { role: 'assistant' as const };                       // not yet stamped
  const aStamped = { role: 'assistant' as const, usage: { inputTokens: 100 } };

  it('targets the trailing assistant of the turn', () => {
    // Normal turn: [user, assistant], nothing persisted yet.
    expect(findTurnUsageStampIndex([u, a], 0)).toBe(1);
  });

  it('still finds the assistant when a user message was surfaced AFTER it (queue:started fallback) — the bug case', () => {
    // handleMessageComplete pushed a queued user message after the just-finished
    // assistant; positional "last element" would attribute usage to the user msg
    // (index 2) and drop it. We must stamp the assistant at index 1.
    expect(findTurnUsageStampIndex([u, a, u], 0)).toBe(1);
  });

  it('only considers the not-yet-persisted range — never re-stamps a prior turn\'s persisted assistant', () => {
    // Prior turn [user, assistant] already persisted (cursor=2); this turn pushed
    // only a user message so far (no new assistant). Must NOT target the old
    // assistant at index 1 with this (different) turn's usage.
    expect(findTurnUsageStampIndex([u, a, u], 2)).toBe(-1);
  });

  it('does NOT re-stamp a STAMPED-but-not-yet-persisted assistant (Codex-caught race)', () => {
    // Turn N's assistant is stamped but its fire-and-forget persist is still
    // blocked (cursor=0, behind it). Turn N+1 completes producing no new
    // assistant. The trailing assistant in range is turn N's — already stamped —
    // so we must return -1 rather than overwrite its usage with turn N+1's.
    expect(findTurnUsageStampIndex([u, aStamped, u], 0)).toBe(-1);
    expect(findTurnUsageStampIndex([u, aStamped], 0)).toBe(-1);
  });

  it('still stamps a genuinely NEW assistant even when a prior stamped assistant precedes it', () => {
    // Turn N stamped (index 1, persist still pending), turn N+1 produced its own
    // assistant (index 3, unstamped). The new one is the trailing assistant → 3.
    expect(findTurnUsageStampIndex([u, aStamped, u, a], 0)).toBe(3);
  });

  it('returns -1 when the turn produced no assistant message', () => {
    expect(findTurnUsageStampIndex([u], 0)).toBe(-1);
    expect(findTurnUsageStampIndex([], 0)).toBe(-1);
  });

  it('picks the LAST assistant in a multi-assistant turn (final response carries the turn aggregate)', () => {
    // text → tool → text within one turn produces two assistant messages (both
    // unstamped until turn end); the turn's usage belongs to the final one.
    expect(findTurnUsageStampIndex([u, a, u, a], 1)).toBe(3);
  });

  it('clamps a negative / oversized fromIndex safely', () => {
    expect(findTurnUsageStampIndex([u, a], -5)).toBe(1);
    expect(findTurnUsageStampIndex([u, a], 99)).toBe(-1);
  });
});

describe('extractTurnUsageFromSdkResult (#358 — stats source-of-truth contract)', () => {
  it('aggregates modelUsage and tracks the highest-token model as primary', () => {
    // Single-model turn — the reported mimo case. Suffixed key must survive verbatim.
    const out = extractTurnUsageFromSdkResult({
      modelUsage: {
        'mimo-v2.5-pro[1m]': {
          inputTokens: 426563,
          outputTokens: 28308,
          cacheReadInputTokens: 1270784,
        },
      },
    });
    expect(out.inputTokens).toBe(426563);
    expect(out.outputTokens).toBe(28308);
    expect(out.cacheReadTokens).toBe(1270784);
    expect(out.cacheCreationTokens).toBe(0);
    expect(out.model).toBe('mimo-v2.5-pro[1m]');
    expect(out.modelUsage).toEqual({
      'mimo-v2.5-pro[1m]': {
        inputTokens: 426563,
        outputTokens: 28308,
        cacheReadTokens: 1270784,
        cacheCreationTokens: undefined,
      },
    });
  });

  it('sums across multiple models, primary = highest in+out total', () => {
    const out = extractTurnUsageFromSdkResult({
      modelUsage: {
        'small-helper': { inputTokens: 100, outputTokens: 50 },
        'main-model': { inputTokens: 5000, outputTokens: 800, cacheReadInputTokens: 200, cacheCreationInputTokens: 10 },
      },
    });
    expect(out.inputTokens).toBe(5100);
    expect(out.outputTokens).toBe(850);
    expect(out.cacheReadTokens).toBe(200);
    expect(out.cacheCreationTokens).toBe(10);
    expect(out.model).toBe('main-model');
  });

  it('falls back to flat usage (snake_case) when modelUsage is absent', () => {
    const out = extractTurnUsageFromSdkResult({
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 5,
      },
    });
    expect(out.inputTokens).toBe(1000);
    expect(out.outputTokens).toBe(200);
    expect(out.cacheReadTokens).toBe(50);
    expect(out.cacheCreationTokens).toBe(5);
    expect(out.model).toBeUndefined();
    expect(out.modelUsage).toBeUndefined();
  });

  it('treats an empty modelUsage map as no breakdown — falls back to flat usage', () => {
    // Without this fallback, an upstream that emits modelUsage:{} alongside a
    // valid flat usage would zero out the turn. Empty map carries no signal.
    const out = extractTurnUsageFromSdkResult({
      modelUsage: {},
      usage: { input_tokens: 7, output_tokens: 3 },
    });
    expect(out.inputTokens).toBe(7);
    expect(out.outputTokens).toBe(3);
  });

  it('returns zeros (not undefined fields) when SDK result has neither modelUsage nor usage', () => {
    const out = extractTurnUsageFromSdkResult({});
    expect(out.inputTokens).toBe(0);
    expect(out.outputTokens).toBe(0);
    expect(out.cacheReadTokens).toBe(0);
    expect(out.cacheCreationTokens).toBe(0);
    expect(out.model).toBeUndefined();
    expect(out.modelUsage).toBeUndefined();
  });

  it('treats missing numeric fields in a model entry as 0 (does not poison aggregate with NaN)', () => {
    const out = extractTurnUsageFromSdkResult({
      modelUsage: {
        'partial': { outputTokens: 10 },
      },
    });
    expect(out.inputTokens).toBe(0);
    expect(out.outputTokens).toBe(10);
    expect(out.cacheReadTokens).toBe(0);
    expect(out.modelUsage?.partial).toEqual({
      inputTokens: 0,
      outputTokens: 10,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined,
    });
  });
});

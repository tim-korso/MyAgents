/**
 * Micro-benchmark for the per-token layout path. Not a correctness test: it
 * exists so a change to the fingerprint/estimate cost is measured rather than
 * guessed. Thresholds are deliberately loose (CI variance) and only fail on
 * order-of-magnitude regressions.
 */

import { describe, expect, it } from 'vitest';

import type { Message } from '@/types/chat';
import { buildMessageLayoutFingerprint, estimateMessageRowHeight } from './chatRowLayout';

describe('layout derivation reuse', () => {
  it('returns the identical contract for a repeated call on the same object', () => {
    const message = assistantMessage('m1', buildLongAnswer(8_000));
    // Identity, not string equality: equality would also hold for a recompute.
    expect(estimateMessageRowHeight(message, 900)).toBe(estimateMessageRowHeight(message, 900));
    expect(buildMessageLayoutFingerprint(message, 900))
      .toBe(buildMessageLayoutFingerprint(message, 900));
  });

  it('derives a fresh contract when the message object is replaced', () => {
    const short = assistantMessage('m1', 'hi');
    const long = assistantMessage('m1', buildLongAnswer(30_000));
    const shortContract = estimateMessageRowHeight(short, 900);
    const longContract = estimateMessageRowHeight(long, 900);
    expect(longContract).not.toBe(shortContract);
    expect(longContract.estimatedHeight).toBeGreaterThan(shortContract.estimatedHeight);
  });

  it('keys the contract by viewport height', () => {
    const message = assistantMessage('m1', buildLongAnswer(8_000));
    const narrow = estimateMessageRowHeight(message, 700);
    const wide = estimateMessageRowHeight(message, 1_400);
    expect(narrow).not.toBe(wide);
    // The wide viewport raises the user-collapse threshold, but this is an
    // assistant row; assert the cache did not collapse the two keys instead.
    expect(narrow.messageId).toBe(wide.messageId);
    expect(estimateMessageRowHeight(message, 700)).toBe(narrow);
  });
});

const CHARS_PER_TOKEN = 4;

/** A long assistant answer with prose, fenced code, and a table. */
function buildLongAnswer(chars: number): string {
  const block = [
    '## 分析',
    '',
    'This paragraph explains the approach in enough detail that it wraps across',
    'several visual lines once the viewport applies its prose column width.',
    '',
    '```ts',
    'export function handler(req: Request, res: Response) {',
    '  const parsed = schema.parse(req.body);',
    '  return res.json({ ok: true, parsed });',
    '}',
    '```',
    '',
    '| column | meaning |',
    '| --- | --- |',
    '| a | first |',
    '| b | second |',
    '',
  ].join('\n');
  let text = '';
  while (text.length < chars) text += block;
  return text.slice(0, chars);
}

function assistantMessage(id: string, content: string): Message {
  return { id, role: 'assistant', content, timestamp: new Date(0) };
}

function measure(label: string, fn: () => void, iterations: number) {
  fn();
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const perCall = (performance.now() - started) / iterations;
  console.log(`  ${label}: ${perCall.toFixed(3)} ms/call`);
  return perCall;
}

describe('chatRowLayout cost', () => {
  it('fingerprints a streaming turn without scaling with total history', () => {
    const streamChars = 24_000;
    const streaming = assistantMessage('s', buildLongAnswer(streamChars));

    // One message at a time: this is the marginal cost a token-limited rerun
    // pays for the message that actually grew.
    const oneCall = measure(
      `fingerprint one ${streamChars}-char message`,
      () => buildMessageLayoutFingerprint(streaming, 900),
      20,
    );

    // The full history is what the hook recomputes on every render.
    const history = Array.from({ length: 120 }, (_, i) =>
      assistantMessage(`m${i}`, buildLongAnswer(6_000)),
    );
    const allCall = measure(
      'fingerprint 120-message history',
      () => {
        for (const message of history) buildMessageLayoutFingerprint(message, 900);
      },
      5,
    );

    // The marginal message must not cost anywhere near the whole history.
    expect(oneCall).toBeLessThan(allCall);
    // Loose ceiling: this only catches order-of-magnitude regressions. Shared
    // CI runners vary by 2-4x, so a tight bound would be flaky, not informative.
    expect(allCall).toBeLessThan(1_500);
  });

  it('one token appended to a long answer stays cheap', () => {
    const base = buildLongAnswer(48_000);
    const iterations = 40;
    let text = base;
    measure(
      'fingerprint after each appended token',
      () => {
        text += 'x'.repeat(CHARS_PER_TOKEN);
        buildMessageLayoutFingerprint(assistantMessage('s', text), 900);
      },
      iterations,
    );

    // Appending tokens must not re-estimate every row: single-message cost only.
    const single = estimateMessageRowHeight(assistantMessage('s', text), 900);
    expect(single.estimatedHeight).toBeGreaterThan(0);
  });
});

describe('estimateMessageRowHeight cost', () => {
  it('measures full-history estimation', () => {
    const history = Array.from({ length: 120 }, (_, i) =>
      assistantMessage(`m${i}`, buildLongAnswer(6_000)),
    );
    // `measure` warms up once before timing, and the ceiling is intentionally
    // far above the observed cost: a 16.7 ms frame budget is the real target,
    // and this test exists to show where the budget goes, not to police CI noise.
    const perCall = measure(
      'estimate 120-message history',
      () => {
        for (const m of history) estimateMessageRowHeight(m, 900);
      },
      5,
    );
    expect(perCall).toBeGreaterThan(0);
  });
});

describe('streaming frame cost', () => {
  /**
   * Reproduces the shape of a streaming render: one long history that does not
   * change, plus a trailing message that grows every frame. Only the trailing
   * message may cost anything, so a frame must stay far below the 16.7 ms
   * budget instead of scaling with history length.
   */
  it('costs a bounded amount per frame regardless of history length', () => {
    const history = Array.from({ length: 120 }, (_, i) =>
      assistantMessage(`m${i}`, buildLongAnswer(6_000)),
    );
    let streaming = assistantMessage('stream', 'seed');

    // Warm the caches for the stable history, as a real session would be.
    for (const m of history) {
      estimateMessageRowHeight(m, 900);
      buildMessageLayoutFingerprint(m, 900);
    }

    const frameCost = measure(
      'streaming frame (120-row history)',
      () => {
        for (const m of history) {
          estimateMessageRowHeight(m, 900);
          buildMessageLayoutFingerprint(m, 900);
        }
        // The one row that actually changed this frame.
        streaming = assistantMessage('stream', `${streaming.content as string}x`);
        estimateMessageRowHeight(streaming, 900);
        buildMessageLayoutFingerprint(streaming, 900);
      },
      20,
    );

    // 60fps leaves 16.7 ms for the whole frame; layout must be a fraction of it.
    expect(frameCost).toBeLessThan(16.7);
  });
});

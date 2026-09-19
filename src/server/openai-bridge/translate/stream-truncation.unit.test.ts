// Regression: an upstream SSE connection cut mid-answer must not be laundered
// into a successfully completed turn.
//
// THE BUG
// `StreamTranslator.finalize()` is the sole emitter of `message_delta` +
// `message_stop`, and the bridge calls it from two places:
//   1. the `[DONE]` protocol terminator (clean end), and
//   2. the pipeline `flush()` (transport EOF fallback, for providers that omit
//      `[DONE]`).
// Path 2 also fires when the socket dies mid-generation — proxy kill, gateway
// idle timeout, dropped TCP. `finalize()` then fabricated a clean
// `stop_reason: end_turn` + `message_stop`, so the truncated text was persisted
// as a normally completed turn: no error surfaced and nothing retried. This is
// exactly the failure class tether's local `retry.js` patch pool catches with
// its "stream ended before message_stop" / "socket hang up" / "ended without"
// patterns.
//
// THE CONTRACT asserted here:
//   - transport-end finalize of a stream that never emitted a terminal signal
//     (no `finish_reason`, no `[DONE]`) throws instead of fabricating
//     `message_stop`;
//   - the `[DONE]` path is unaffected and stays the preferred happy path;
//   - a stream that DID emit `finish_reason` still finalizes cleanly even when
//     it is closed without `[DONE]` (provider-omits-DONE tolerance must survive).

import { describe, it, expect } from 'vitest';
import { StreamTranslator } from './stream';
import { ResponsesStreamTranslator } from './stream-responses';
import { handleStreamResponse, handleResponsesStreamResponse } from '../handler';
import type { OpenAIStreamChunk } from '../types/openai';
import type { ResponsesStreamEvent } from '../types/openai-responses';
import type { AnthropicStreamEvent } from '../types/anthropic';

const MODEL = 'deepseek-v4-flash';

function chunk(
  partial: Partial<OpenAIStreamChunk> & Pick<OpenAIStreamChunk, 'choices'>,
): OpenAIStreamChunk {
  return { id: 'c', object: 'chat.completion.chunk', created: 0, model: MODEL, ...partial };
}

const contentChunk = (text: string) =>
  chunk({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });

describe('StreamTranslator truncation detection', () => {
  it('throws on transport-end finalize when no terminal signal was ever seen', () => {
    const t = new StreamTranslator(MODEL);
    t.feed(contentChunk('Half an answer that gets cu'));

    expect(() => t.finalize(true)).toThrow(/truncated/i);
  });

  it('keeps the [DONE] path clean: explicit finalize without viaTransportEnd still emits message_stop', () => {
    const t = new StreamTranslator(MODEL);
    t.feed(contentChunk('A complete answer.'));

    const events = t.finalize();
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
    const delta = events.find((e) => e.type === 'message_delta');
    expect(delta).toBeDefined();
  });

  it('still finalizes cleanly on transport end when the provider sent finish_reason but omitted [DONE]', () => {
    const t = new StreamTranslator(MODEL);
    t.feed(contentChunk('Done text'));
    t.feed(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));

    const events = t.finalize(true);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
    const delta = events.find((e) => e.type === 'message_delta');
    expect(delta && delta.type === 'message_delta' ? delta.delta.stop_reason : null).toBe('end_turn');
  });

  it('does not throw on transport end when the stream never started (no events to truncate)', () => {
    const t = new StreamTranslator(MODEL);
    expect(t.finalize(true)).toEqual([]);
  });

  it('is idempotent: a second transport-end finalize after a clean one is a no-op, not a throw', () => {
    const t = new StreamTranslator(MODEL);
    t.feed(contentChunk('text'));
    t.feed(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));

    const first = t.finalize(true);
    expect(first.some((e) => e.type === 'message_stop')).toBe(true);
    expect(t.finalize(true)).toEqual([]);
  });
});

/** Drain an Anthropic SSE body, returning the parsed events and whether the
 *  stream closed cleanly or errored. */
async function drain(body: ReadableStream<Uint8Array>): Promise<{
  events: AnthropicStreamEvent[];
  error: unknown;
}> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: AnthropicStreamEvent[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const dataLine = part.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        try {
          events.push(JSON.parse(dataLine.slice('data:'.length).trim()) as AnthropicStreamEvent);
        } catch { /* skip malformed */ }
      }
    }
    return { events, error: null };
  } catch (error) {
    return { events, error };
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
}

/** Build an upstream SSE body whose controller stays open so the test can
 *  decide between closing cleanly and erroring out mid-stream. */
function openSseBody() {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const send = (payload: object | '[DONE]') => {
    const data = payload === '[DONE]' ? '[DONE]' : JSON.stringify(payload);
    ctrl.enqueue(enc.encode(`data: ${data}\n\n`));
  };
  return { body, send, close: () => ctrl.close(), fail: (e: unknown) => ctrl.error(e) };
}

describe('bridge handler surfaces mid-stream truncation as an error', () => {
  it('errors the downstream body when the upstream socket dies without finish_reason or [DONE]', async () => {
    const upstream = openSseBody();
    const out = handleStreamResponse(
      new Response(upstream.body, { headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      true,
      () => {},
      undefined,
      new AbortController(),
      undefined,
      () => {},
    );

    upstream.send(chunk({ choices: [{ index: 0, delta: { content: 'Partial answer' }, finish_reason: null }] }));
    // Cut the connection mid-answer: no finish_reason, no [DONE].
    upstream.fail(new Error('socket hang up'));

    const { events, error } = await drain(out.body!);
    // The half answer still reaches the client, but the stream must NOT be
    // terminated by a fabricated clean message_stop.
    expect(events.some((e) => e.type === 'message_stop')).toBe(false);
    expect(error).toBeTruthy();
  });

  it('closes cleanly with message_stop when the upstream sends finish_reason and [DONE]', async () => {
    const upstream = openSseBody();
    const out = handleStreamResponse(
      new Response(upstream.body, { headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      true,
      () => {},
      undefined,
      new AbortController(),
      undefined,
      () => {},
    );

    upstream.send(chunk({ choices: [{ index: 0, delta: { content: 'Complete answer' }, finish_reason: null }] }));
    upstream.send(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    upstream.send('[DONE]');

    const { events, error } = await drain(out.body!);
    expect(error).toBeNull();
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });

  it('tolerates a provider that omits [DONE] but does send finish_reason (clean transport EOF)', async () => {
    const upstream = openSseBody();
    const out = handleStreamResponse(
      new Response(upstream.body, { headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      true,
      () => {},
      undefined,
      new AbortController(),
      undefined,
      () => {},
    );

    upstream.send(chunk({ choices: [{ index: 0, delta: { content: 'Complete without DONE' }, finish_reason: null }] }));
    upstream.send(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    upstream.close();

    const { events, error } = await drain(out.body!);
    expect(error).toBeNull();
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });
});

// The Responses API path (`apiProtocol: openai-responses`) had the identical
// hole: `finalize()` unconditionally manufactured `end_turn` + `message_stop`,
// and the only legitimate terminal signals are `response.completed` /
// `response.failed`. A cut socket therefore looked like a finished turn.
describe('ResponsesStreamTranslator truncation detection', () => {
  const textDelta = (delta: string): ResponsesStreamEvent =>
    ({ type: 'response.output_text.delta', delta } as ResponsesStreamEvent);
  const completed = (): ResponsesStreamEvent =>
    ({ type: 'response.completed', response: { status: 'completed' } } as ResponsesStreamEvent);

  it('throws on transport-end finalize when response.completed never arrived', () => {
    const t = new ResponsesStreamTranslator(MODEL);
    t.feed(textDelta('Half an answer that gets cu'));

    expect(() => t.finalize(true)).toThrow(/truncated/i);
  });

  it('finalizes cleanly on transport end once response.completed was received', () => {
    const t = new ResponsesStreamTranslator(MODEL);
    t.feed(textDelta('Complete answer.'));
    t.feed(completed());

    // response.completed already emitted the terminal events and set
    // hasFinished, so the fallback is a no-op rather than a throw.
    expect(t.finalize(true)).toEqual([]);
  });

  it('does not throw on transport end when the stream never started', () => {
    const t = new ResponsesStreamTranslator(MODEL);
    expect(t.finalize(true)).toEqual([]);
  });
});

describe('bridge handler surfaces Responses truncation as an error', () => {
  it('errors the downstream body when a Responses socket dies before response.completed', async () => {
    const enc = new TextEncoder();
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    const out = handleResponsesStreamResponse(
      new Response(upstreamBody, { headers: { 'content-type': 'text/event-stream' } }),
      MODEL,
      () => {},
      new AbortController(),
      undefined,
      () => {},
    );

    ctrl.enqueue(enc.encode(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Partial answer' })}\n\n`,
    ));
    ctrl.error(new Error('socket hang up'));

    const { events, error } = await drain(out.body!);
    expect(events.some((e) => e.type === 'message_stop')).toBe(false);
    expect(error).toBeTruthy();
  });
});

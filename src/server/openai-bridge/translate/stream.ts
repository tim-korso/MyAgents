// StreamTranslator: OpenAI stream chunks → Anthropic SSE events (state machine)

import type { AnthropicStreamEvent, AnthropicResponse, AnthropicStopReason } from '../types/anthropic';
import type { OpenAIStreamChunk, OpenAIStreamToolCall } from '../types/openai';
import { translateStopReason } from './response';
import { generateMessageId, generateToolUseId } from '../utils/id';
import { emptyUsage, mergeUsage, toAnthropicUsage, type UsageSnapshot, type UsageWarningLogger } from './usage';

interface ToolCallBuffer {
  id: string;
  name: string;
  args: string;
}

export class StreamTranslator {
  private messageId: string;
  private requestModel: string;
  private contentIndex = 0;
  private activeBlockType: 'text' | 'thinking' | 'tool_use' | null = null;
  private toolCallBuffers = new Map<number, ToolCallBuffer>();
  private usage: UsageSnapshot = emptyUsage();
  private hasEmittedStart = false;
  private hasFinished = false;
  /**
   * True once the translator has observed a terminal signal for this stream:
   * either a `finish_reason` on a choice, or the `[DONE]` protocol terminator
   * (which enqueues STREAM_DONE without touching `feed()`).
   *
   * WHY THIS EXISTS — the bug it fixes:
   * `finalize()` is the sole emitter of `message_stop`, and it is invoked BOTH
   * on the happy path (`[DONE]`) and on transport EOF/flush, as a fallback so a
   * provider that omits `[DONE]` still terminates cleanly. But that fallback
   * also fires when the upstream connection is *cut mid-answer* — a proxy
   * killing the socket, a gateway idle timeout, a dropped TCP connection.
   * In that case the client received a syntactically valid `message_stop` and
   * treats a half-written answer as a normally completed turn: the truncated
   * text is persisted and the turn is reported as success, with no error and
   * no retry. The same failure mode tether's local `retry.js` patch pool exists
   * to catch ("stream ended before message_stop" / "socket hang up" /
   * "ended without ...").
   *
   * With this flag the fallback path can tell "provider never sent a terminal
   * signal" (abrupt truncation → must not masquerade as success) apart from
   * "provider sent `[DONE]`" (clean end).
   */
  private hasTerminalSignal = false;
  private stopReason: AnthropicStopReason | null = null;
  private translateReasoning: boolean;
  private usageWarning: UsageWarningLogger | undefined;

  constructor(requestModel: string, translateReasoning = true, usageWarning?: UsageWarningLogger) {
    this.messageId = generateMessageId();
    this.requestModel = requestModel;
    this.translateReasoning = translateReasoning;
    let warned = false;
    this.usageWarning = usageWarning
      ? (message) => {
          if (warned) return;
          warned = true;
          usageWarning(message);
        }
      : undefined;
  }

  /** Feed an OpenAI stream chunk, returns Anthropic SSE events to emit */
  feed(chunk: OpenAIStreamChunk): AnthropicStreamEvent[] {
    const events: AnthropicStreamEvent[] = [];

    // Emit message_start on first chunk
    if (!this.hasEmittedStart) {
      this.hasEmittedStart = true;
      events.push(this.makeMessageStart());
    }

    // Track usage
    if (chunk.usage) {
      this.usage = mergeUsage(this.usage, chunk.usage, this.usageWarning);
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      // Usage-only chunk (final chunk with no choices)
      return events;
    }

    const delta = choice.delta;

    // Handle reasoning_content (thinking)
    if (this.translateReasoning && delta.reasoning_content) {
      if (this.activeBlockType !== 'thinking') {
        this.closeActiveBlock(events);
        this.activeBlockType = 'thinking';
        events.push({
          type: 'content_block_start',
          index: this.contentIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        });
      }
      events.push({
        type: 'content_block_delta',
        index: this.contentIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      });
    }

    // Handle text content
    if (delta.content) {
      if (this.activeBlockType !== 'text') {
        this.closeActiveBlock(events);
        this.activeBlockType = 'text';
        events.push({
          type: 'content_block_start',
          index: this.contentIndex,
          content_block: { type: 'text', text: '' },
        });
      }
      events.push({
        type: 'content_block_delta',
        index: this.contentIndex,
        delta: { type: 'text_delta', text: delta.content },
      });
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        this.handleToolCallDelta(tc, events);
      }
    }

    // Handle finish.
    // Per the OpenAI spec, with stream_options.include_usage=true the `usage`
    // payload arrives in a SEPARATE trailing chunk (empty `choices`) AFTER this
    // finish_reason chunk. Emitting the terminal message_delta/message_stop here
    // would pin token counts to whatever was known so far (0) — the trailing
    // usage chunk would then be dropped (it returns early above on `!choice`).
    // So we close the active block + record the stop_reason now, but defer the
    // terminal events to finalize() (emitted on stream end / flush), by which
    // point `this.usage` has accumulated the trailing usage chunk. See issue #277.
    if (choice.finish_reason) {
      this.closeActiveBlock(events);
      this.stopReason = translateStopReason(choice.finish_reason);
      // A finish_reason is an in-band terminal signal: the provider told us why
      // it stopped generating. Only the *absence* of any terminal signal on the
      // finalize fallback means the stream was cut, so record it here.
      this.hasTerminalSignal = true;
    }

    return events;
  }

  private handleToolCallDelta(tc: OpenAIStreamToolCall, events: AnthropicStreamEvent[]): void {
    const idx = tc.index;

    if (!this.toolCallBuffers.has(idx)) {
      // New tool call — close previous block, start new tool_use
      this.closeActiveBlock(events);
      this.activeBlockType = 'tool_use';

      const id = tc.id || generateToolUseId();
      const name = tc.function?.name || '';
      this.toolCallBuffers.set(idx, { id, name, args: '' });

      // IMPORTANT: thought_signature is intentionally NOT included on content_block_start.
      // The SDK stores these events in its session transcript and replays them on resume.
      // Including non-standard fields causes API rejection ("Extra inputs are not permitted").
      // The bridge handler caches thought_signatures separately. See: #68
      events.push({
        type: 'content_block_start',
        index: this.contentIndex,
        content_block: { type: 'tool_use', id, name, input: {} },
      });
    }

    // Accumulate arguments
    const buffer = this.toolCallBuffers.get(idx)!;
    if (tc.function?.arguments) {
      buffer.args += tc.function.arguments;
      events.push({
        type: 'content_block_delta',
        index: this.contentIndex,
        delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
      });
    }
  }

  /**
   * Finalize the stream — emit the terminal message_delta + message_stop.
   * Invoked by the handler on the `[DONE]` protocol terminator (preferred) or on
   * stream flush / transport end (fallback for streams that close without one).
   * This is the SOLE emitter of terminal events: feed() defers them here so the
   * full usage (including the trailing usage-only chunk) is reported. Carries the
   * stop_reason captured from finish_reason (defaults to 'end_turn' for streams
   * that ended without one). No-op if already finalized or never started.
   *
   * @param viaTransportEnd `true` when the caller is finalizing because the
   * transport ended or the pipeline flushed, rather than because the `[DONE]`
   * protocol terminator arrived. In that mode `finalize()` is a *fallback*,
   * and a stream that produced content without ever emitting a terminal signal
   * was truncated mid-answer — see `hasTerminalSignal`.
   */
  finalize(viaTransportEnd = false): AnthropicStreamEvent[] {
    if (this.hasFinished || !this.hasEmittedStart) return [];

    // Abrupt truncation must not be laundered into a successful turn. Throw so
    // the handler's transport-error path surfaces it to the client (the same
    // path used for a read error), instead of emitting a fabricated
    // `message_stop` that persists a half answer as complete.
    if (viaTransportEnd && !this.hasTerminalSignal) {
      this.hasFinished = true;
      throw new Error(
        'Upstream stream ended before a terminal event '
        + '(no finish_reason and no [DONE]); treating response as truncated',
      );
    }

    const events: AnthropicStreamEvent[] = [];
    this.closeActiveBlock(events);
    this.hasFinished = true;

    events.push({
      type: 'message_delta',
      delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null },
      usage: toAnthropicUsage(this.usage),
    });
    events.push({ type: 'message_stop' });
    return events;
  }

  private closeActiveBlock(events: AnthropicStreamEvent[]): void {
    if (this.activeBlockType !== null) {
      events.push({ type: 'content_block_stop', index: this.contentIndex });
      this.contentIndex++;
      this.activeBlockType = null;
    }
  }

  private makeMessageStart(): AnthropicStreamEvent {
    const message: AnthropicResponse = {
      id: this.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: this.requestModel,
      stop_reason: null,
      stop_sequence: null,
      usage: toAnthropicUsage(this.usage),
    };
    return { type: 'message_start', message };
  }
}

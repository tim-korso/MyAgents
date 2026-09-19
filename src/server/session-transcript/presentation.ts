import type { TranscriptObject, TranscriptOperation } from '../../shared/sessionTranscript';
import { ProductTranscriptContent, type ProductBlockTarget } from './content';

type NativeBlock = { type: string; target: ProductBlockTarget; index?: number; confirmed: boolean; fragments?: { target: ProductBlockTarget; end?: number }[] };
type NativeMessage = { blocks: NativeBlock[]; deliveries: Map<string, NativeBlock[]> };

/** Normalizes the adapters' product presentation events, before SSE transport.
 * Final native blocks/inputs and deferred attachments also call the content
 * owner directly: a transport preview/reference is not the complete source.
 */
export class TranscriptPresentation {
  private text: ProductBlockTarget | undefined;
  private thinking: ProductBlockTarget | undefined;
  private sequence = 0;
  private nativeMessageId: string | undefined;
  private readonly childNativeMessages = new Map<string, string>();
  private readonly nativeMessages = new Map<string, NativeMessage>();
  private readonly nativeStreams = new Map<number, NativeBlock>();
  private readonly retractedUuids = new Set<string>();
  private readonly retractedNativeMessages = new Set<string>();

  constructor(readonly content: ProductTranscriptContent, publish?: (operation: TranscriptOperation) => void, private readonly onTextComplete?: (target: ProductBlockTarget) => void) {
    content.writer.subscribeOperations(operation => {
      if (operation.kind !== 'messages-remove') return;
      const removed = new Set(operation.messageIds);
      if (this.text && removed.has(this.text.messageId)) this.text = undefined;
      if (this.thinking && removed.has(this.thinking.messageId)) this.thinking = undefined;
      for (const [index, block] of this.nativeStreams) {
        if (removed.has(block.target.messageId)) this.nativeStreams.delete(index);
      }
      for (const [id, message] of this.nativeMessages) {
        if (message.blocks.every(block => removed.has(block.target.messageId))) this.nativeMessages.delete(id);
      }
    });
    if (publish) content.writer.subscribeOperations(publish);
  }

  get currentNativeMessageId(): string | undefined { return this.nativeMessageId; }

  beginNativeMessage(id: string, parentToolUseId?: string): void {
    if (parentToolUseId) {
      this.childNativeMessages.set(parentToolUseId, id);
      return;
    }
    this.closeText();
    this.closeThinking();
    this.nativeMessageId = id;
    this.nativeStreams.clear();
  }

  private nativeMessage(id: string): NativeMessage {
    let message = this.nativeMessages.get(id);
    if (!message) {
      message = { blocks: [], deliveries: new Map() };
      this.nativeMessages.set(id, message);
    }
    return message;
  }

  /** A stream index is scoped to one model response, never to the product turn. */
  beginNativeBlock(index: number, block: TranscriptObject, parentToolUseId?: string): void {
    const nativeMessageId = parentToolUseId ? this.childNativeMessages.get(parentToolUseId) : this.nativeMessageId;
    if (!nativeMessageId || this.retractedNativeMessages.has(nativeMessageId) || typeof block.type !== 'string') return;
    const message = this.nativeMessage(nativeMessageId);
    let entry = message.blocks.find(candidate => candidate.index === index);
    entry ??= message.blocks.find(candidate => candidate.index === undefined && candidate.type === block.type);
    if (!entry) {
      const target = this.createNativeBlock(`${nativeMessageId}:${index}`, block, parentToolUseId);
      if (!target) return;
      entry = { type: block.type, target, index, confirmed: false };
      message.blocks.push(entry);
    }
    entry.index = index;
    if (parentToolUseId) {
      this.content.updateTool(entry.target, { nativeMessageId });
      return;
    }
    this.content.updateBlock(entry.target, { nativeMessageId });
    this.nativeStreams.set(index, entry);
    if (block.type === 'text') {
      this.closeText();
      this.closeThinking();
      this.text = entry.target;
    } else if (block.type === 'thinking') {
      this.closeText();
      this.closeThinking();
      this.thinking = entry.target;
    }
  }

  hasNativeBlock(id: string, index: number): boolean {
    return this.nativeMessages.get(id)?.blocks.some(block => block.index === index) ?? false;
  }

  childNativeBlock(parentToolUseId: string, index: number): NativeBlock | undefined {
    const id = this.childNativeMessages.get(parentToolUseId);
    return id && !this.retractedNativeMessages.has(id) ? this.nativeMessages.get(id)?.blocks.find(block => block.index === index) : undefined;
  }

  appendChildNativeText(parentToolUseId: string, index: number, text: string): ProductBlockTarget | undefined {
    const entry = this.childNativeBlock(parentToolUseId, index);
    if (!entry || entry.confirmed || (entry.type !== 'text' && entry.type !== 'thinking')) return undefined;
    this.content.append(entry.target, 'result', text);
    return entry.target;
  }

  endNativeBlock(index: number, parentToolUseId?: string): void {
    if (parentToolUseId) {
      const entry = this.childNativeBlock(parentToolUseId, index);
      if (entry && (entry.type === 'text' || entry.type === 'thinking')) this.content.updateTool(entry.target, { isLoading: false }, true);
      return;
    }
    const entry = this.nativeStreams.get(index);
    if (entry?.type === 'text' && (this.text?.blockId === entry.target.blockId || entry.fragments?.some(part => part.target.blockId === this.text?.blockId))) this.closeText();
    if (entry?.type === 'thinking' && (this.thinking?.blockId === entry.target.blockId || entry.fragments?.some(part => part.target.blockId === this.thinking?.blockId))) this.closeThinking();
  }

  /** SDK complete frames contain one block, and sibling frames share model id.
   * Wire UUID identifies a delivery; it cannot deduplicate the entire response.
   */
  confirmNativeBlocks(id: string, deliveryId: string, blocks: TranscriptObject[], parentToolUseId?: string, provenance: 'sdk' | 'native' = 'sdk'): { target: ProductBlockTarget; textDelta: string }[] {
    if (this.retractedUuids.has(deliveryId) || this.retractedNativeMessages.has(id)) return [];
    const message = this.nativeMessage(id);
    const prior = message.deliveries.get(deliveryId);
    const delivered: NativeBlock[] = [];
    const changes: { target: ProductBlockTarget; textDelta: string }[] = [];
    for (const [position, block] of blocks.entries()) {
      if (typeof block.type !== 'string') continue;
      let entry = prior?.[position];
      const toolId = typeof block.id === 'string' ? block.id : undefined;
      entry ??= message.blocks.find(candidate => !candidate.confirmed && candidate.type === block.type
        && (!toolId || this.content.readTool(candidate.target)?.id === toolId));
      if (!entry || !this.content.readBlock(entry.target)) {
        const target = this.createNativeBlock(`${id}:${deliveryId}:${position}`, block, parentToolUseId);
        if (!target) continue;
        entry = { type: block.type, target, confirmed: false };
        message.blocks.push(entry);
      }
      delivered[position] = entry;
      const previous = entry.target.subagentToolId ? this.content.readTool(entry.target) : this.content.readBlock(entry.target);
      let textDelta = '';
      if (block.type === 'text' && typeof block.text === 'string') {
        const field = entry.target.subagentToolId ? 'result' : 'text';
        const oldText = typeof previous?.[field] === 'string' ? previous[field] as string : '';
        if (entry.target.subagentToolId) {
          this.content.confirmText(entry.target, field, block.text);
          textDelta = block.text.startsWith(oldText) ? block.text.slice(oldText.length) : '';
        } else textDelta = this.confirmRootText(entry, 'text', block.text);
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        if (entry.target.subagentToolId) this.content.confirmText(entry.target, 'result', block.thinking);
        else this.confirmRootText(entry, 'thinking', block.thinking);
        if (typeof block.signature === 'string') {
          if (entry.target.subagentToolId) this.content.updateTool(entry.target, { signature: block.signature });
          else this.content.updateBlock(entry.target, { signature: block.signature });
        }
      } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        const input = object(block.input);
        if (input) this.content.confirmInput(entry.target, input);
        if (typeof block.thought_signature === 'string') this.content.updateTool(entry.target, { thought_signature: block.thought_signature });
      }
      if (entry.target.subagentToolId) this.content.updateTool(entry.target, {
        nativeMessageId: id, ...(provenance === 'sdk' ? { sdkUuid: deliveryId } : {}),
        ...(block.type === 'text' || block.type === 'thinking' ? { isLoading: false } : {}),
      }, true);
      else for (const part of entry.fragments ?? [{ target: entry.target }]) {
        const wasComplete = this.content.readBlock(part.target)?.isComplete;
        this.content.updateBlock(part.target, { isComplete: true, nativeMessageId: id, ...(provenance === 'sdk' ? { sdkUuid: deliveryId } : {}) }, true);
        if (block.type === 'text' && !wasComplete) this.onTextComplete?.(part.target);
      }
      entry.confirmed = true;
      // Only the final fragment reaches this native delivery boundary.
      // Earlier fragments are display cuts, not independent native history.
      changes.push({ target: entry.fragments?.at(-1)?.target ?? entry.target, textDelta });
    }
    message.deliveries.set(deliveryId, delivered);
    return changes;
  }

  /** A display fragment ending inside a native block has no exact SDK cut. */
  sdkBoundary(messageId: string): string | undefined {
    const blocks = this.content.writer.projection.messages.get(messageId)?.content;
    if (!Array.isArray(blocks)) return undefined;
    for (const message of this.nativeMessages.values()) for (const block of message.blocks) {
      if (block.fragments?.slice(0, -1).some(part => part.target.messageId === messageId && this.content.readBlock(part.target))) return undefined;
    }
    const last = blocks.at(-1);
    return typeof last?.sdkUuid === 'string' ? last.sdkUuid : undefined;
  }

  retractNativeContent(uuids: readonly string[], includeCurrentStream: boolean, parentToolUseId?: string): string[] {
    const fresh = new Set(uuids.filter(uuid => !this.retractedUuids.has(uuid)));
    if (fresh.size === 0) return [];
    for (const uuid of fresh) this.retractedUuids.add(uuid);
    const removedMessages: string[] = [];
    for (const message of this.content.writer.projection.messages.values()) {
      if (message.role !== 'assistant') continue;
      if (typeof message.content === 'string') {
        if (message.sdkUuid && fresh.has(message.sdkUuid)) removedMessages.push(message.id);
        continue;
      }
      for (const block of message.content) {
        const calls = object(block.tool)?.subagentCalls;
        if (!Array.isArray(calls)) continue;
        const childModel = parentToolUseId ? this.childNativeMessages.get(parentToolUseId) : undefined;
        const removed = calls.map(object).filter(call => call && (
          (typeof call.sdkUuid === 'string' && fresh.has(call.sdkUuid))
          || (includeCurrentStream && childModel && call.nativeMessageId === childModel)));
        for (const call of removed) if (typeof call!.nativeMessageId === 'string') this.retractedNativeMessages.add(call!.nativeMessageId);
        if (removed.length) this.content.removeSubagents(message.id, block.id, removed.map(call => String(call!.id)));
      }
      const removedBlocks = message.content.filter(block =>
        (typeof block.sdkUuid === 'string' && fresh.has(block.sdkUuid))
        || (!parentToolUseId && includeCurrentStream && this.nativeMessageId && block.nativeMessageId === this.nativeMessageId));
      if (removedBlocks.length === 0) {
        if (message.sdkUuid && fresh.has(message.sdkUuid) && !message.content.some(block => block.nativeMessageId)) removedMessages.push(message.id);
        continue;
      }
      for (const block of removedBlocks) if (typeof block.nativeMessageId === 'string') this.retractedNativeMessages.add(block.nativeMessageId);
      if (removedBlocks.length === message.content.length) removedMessages.push(message.id);
      else {
        this.content.removeBlocks(message.id, removedBlocks.map(block => block.id));
        const sdkUuid = this.sdkBoundary(message.id);
        this.content.writer.observe({ kind: 'message-update', messageId: message.id,
          details: typeof sdkUuid === 'string' ? { sdkUuid } : {},
          ...(typeof sdkUuid !== 'string' ? { clear: ['sdkUuid'] as const } : {}),
        });
      }
    }
    if (removedMessages.length) this.content.removeMessages(removedMessages);
    if (this.text && !this.content.readBlock(this.text)) this.text = undefined;
    if (this.thinking && !this.content.readBlock(this.thinking)) this.thinking = undefined;
    return removedMessages;
  }

  private createNativeBlock(key: string, block: TranscriptObject, parentToolUseId?: string): ProductBlockTarget | undefined {
    if (parentToolUseId && (block.type === 'text' || block.type === 'thinking')) {
      const name = block.type === 'text' ? 'AgentMessage' : 'Thinking';
      return this.content.startTool(`${name}::${key}::${parentToolUseId}`, name, {}, parentToolUseId);
    }
    if (block.type === 'text') return this.content.block(`native:${key}`, 'text', { text: '', isComplete: false });
    if (block.type === 'thinking') return this.content.block(`native:${key}`, 'thinking', {
      thinking: '', thinkingStartedAt: Date.now(), isComplete: false,
    });
    if ((block.type === 'tool_use' || block.type === 'server_tool_use') && typeof block.id === 'string' && typeof block.name === 'string') {
      return this.content.startTool(block.id, block.name, {}, parentToolUseId, block.type);
    }
    return undefined;
  }

  private isConfirmed(target: ProductBlockTarget): boolean {
    return [...this.nativeStreams.values()].some(entry => entry.confirmed && (entry.target.blockId === target.blockId
      || entry.fragments?.some(fragment => fragment.target.blockId === target.blockId)));
  }

  private splitNativeStream(target: ProductBlockTarget | undefined, type: 'text' | 'thinking'): ProductBlockTarget | undefined {
    if (!target) return undefined;
    const entry = [...this.nativeStreams.values()].find(candidate => candidate.type === type &&
      (candidate.target.blockId === target.blockId || candidate.fragments?.some(part => part.target.blockId === target.blockId)));
    if (!entry) return undefined;
    if (entry.confirmed || target.messageId === this.content.currentAssistantId) return target;
    const fragments = entry.fragments ??= [{ target: entry.target }];
    const last = fragments[fragments.length - 1];
    const text = this.content.readBlock(last.target)?.[type];
    const start = fragments.length > 1 ? fragments[fragments.length - 2].end! : 0;
    last.end = start + (typeof text === 'string' ? text.length : 0);
    const wasComplete = this.content.readBlock(last.target)?.isComplete;
    this.content.writer.observe({ kind: 'message-update', messageId: last.target.messageId, details: {}, clear: ['sdkUuid'] });
    this.content.updateBlock(last.target, { isComplete: true });
    if (type === 'text' && !wasComplete) this.onTextComplete?.(last.target);
    const next = this.content.block(`native-segment:${++this.sequence}`, type, {
      [type]: '', nativeMessageId: this.nativeMessageId, isComplete: false,
      ...(type === 'thinking' ? { thinkingStartedAt: Date.now() } : {}),
    });
    fragments.push({ target: next });
    return next;
  }

  private confirmRootText(entry: NativeBlock, field: 'text' | 'thinking', text: string): string {
    const fragments = entry.fragments ?? [{ target: entry.target }];
    const prior = fragments.map(part => this.content.readBlock(part.target)?.[field] ?? '').join('');
    let start = 0;
    for (const part of fragments) {
      const end = part.end ?? text.length;
      this.content.confirmText(part.target, field, text.slice(start, end));
      start = end;
    }
    return text.startsWith(prior) ? text.slice(prior.length) : '';
  }

  private textTarget(): ProductBlockTarget {
    this.text = this.splitNativeStream(this.text, 'text') ?? this.text;
    if (this.text && this.isConfirmed(this.text)) return this.text;
    if (!this.text || this.text.messageId !== this.content.currentAssistantId) {
      this.closeThinking();
      this.text = this.content.block(`text:${++this.sequence}`, 'text', { text: '', isComplete: false });
    }
    return this.text;
  }

  private thinkingTarget(index?: unknown): ProductBlockTarget {
    this.thinking = this.splitNativeStream(this.thinking, 'thinking') ?? this.thinking;
    if (this.thinking && this.isConfirmed(this.thinking)) return this.thinking;
    if (!this.thinking || this.thinking.messageId !== this.content.currentAssistantId) {
      this.closeText();
      this.thinking = this.content.block(`thinking:${++this.sequence}`, 'thinking', {
        thinking: '', thinkingStartedAt: Date.now(),
        ...(typeof index === 'number' ? { thinkingStreamIndex: index } : {}), isComplete: false,
      });
    }
    return this.thinking;
  }

  closeText(details: TranscriptObject = {}): void {
    if (this.text) {
      const wasComplete = this.content.readBlock(this.text)?.isComplete;
      this.content.updateBlock(this.text, { ...details, isComplete: true }, true);
      if (!wasComplete) this.onTextComplete?.(this.text);
    }
    this.text = undefined;
  }

  closeThinking(): void {
    if (this.thinking) {
      const block = this.content.readBlock(this.thinking);
      this.content.updateBlock(this.thinking, {
        isComplete: true,
        ...(typeof block?.thinkingStartedAt === 'number' ? { thinkingDurationMs: Math.max(0, Date.now() - block.thinkingStartedAt) } : {}),
      }, true);
    }
    this.thinking = undefined;
  }

  record(event: string, payload: unknown): void {
    if (this.nativeMessageId && this.retractedNativeMessages.has(this.nativeMessageId)
      && (event === 'chat:message-chunk' || event === 'chat:thinking-start' || event === 'chat:thinking-chunk'
        || event === 'chat:tool-use-start' || event === 'chat:server-tool-use-start')) return;
    if (event === 'chat:message-chunk') {
      if (typeof payload === 'string' && payload) {
        const target = this.textTarget();
        if (!this.isConfirmed(target)) this.content.append(target, 'text', payload);
      }
      return;
    }
    const data = object(payload);
    if (!data) return;
    switch (event) {
      case 'chat:thinking-start':
        if (typeof data.index === 'number' && this.nativeStreams.get(data.index)?.target.blockId === this.thinking?.blockId) return;
        this.closeThinking();
        this.thinkingTarget(data.index);
        return;
      case 'chat:thinking-chunk':
        if (typeof data.delta === 'string') {
          const target = this.thinkingTarget(data.index);
          if (!this.isConfirmed(target)) this.content.append(target, 'thinking', data.delta);
        }
        return;
      case 'chat:tool-use-start':
      case 'chat:server-tool-use-start':
      case 'chat:subagent-tool-use': {
        if (data.inputRef) return; // Transport reference; the full native input was already confirmed.
        const tool = event === 'chat:subagent-tool-use' ? object(data.tool) : data;
        if (!tool || typeof tool.id !== 'string' || typeof tool.name !== 'string') return;
        this.closeText();
        this.closeThinking();
        const target = this.content.startTool(tool.id, tool.name,
          typeof tool.streamIndex === 'number' ? { streamIndex: tool.streamIndex } : {},
          typeof data.parentToolUseId === 'string' ? data.parentToolUseId : undefined,
          event === 'chat:server-tool-use-start' ? 'server_tool_use' : 'tool_use');
        const input = object(tool.input);
        if (target && input && (Object.keys(input).length > 0 || data.finalInput === true)) this.content.confirmInput(target, input);
        return;
      }
      case 'chat:tool-input-delta':
      case 'chat:subagent-tool-input-delta': {
        const target = typeof data.toolId === 'string' ? this.content.tool(data.toolId) : undefined;
        if (target && typeof data.delta === 'string' && !this.content.readTool(target)?.inputComplete) this.content.append(target, 'inputJson', data.delta);
        return;
      }
      case 'chat:content-block-stop': {
        if (data.type === 'text') {
          if (data.asyncQuestions && !this.text) {
            const id = object(data.asyncQuestions)?.id;
            this.text = this.content.block(`question:${String(id ?? ++this.sequence)}`, 'text', { text: '' });
          }
          this.closeText(data.asyncQuestions ? { asyncQuestions: data.asyncQuestions } : {});
        }
        else if (data.type === 'thinking') this.closeThinking();
        else if (typeof data.toolId === 'string') {
          const target = this.content.tool(data.toolId);
          const input = object(data.input);
          if (target && input) this.content.confirmInput(target, input);
          else if (target) this.content.updateTool(target, { inputComplete: true }, true);
        }
        return;
      }
      case 'chat:subagent-status': {
        const target = typeof data.parentToolUseId === 'string' ? this.content.tool(data.parentToolUseId) : undefined;
        if (target && data.lifecycle) this.content.updateTool(target, { subagentLifecycle: data.lifecycle }, true);
        return;
      }
      case 'chat:tool-result-delta':
      case 'chat:subagent-tool-result-delta': {
        const target = typeof data.toolUseId === 'string' ? this.content.tool(data.toolUseId) : undefined;
        if (target && typeof data.delta === 'string') this.content.append(target, 'result', data.delta);
        return;
      }
      case 'chat:tool-result-start':
      case 'chat:tool-result-complete':
      case 'chat:subagent-tool-result-start':
      case 'chat:subagent-tool-result-complete': {
        const target = typeof data.toolUseId === 'string' ? this.content.tool(data.toolUseId) : undefined;
        if (!target) return;
        if (typeof data.content === 'string') this.content.confirmText(target, 'result', data.content);
        this.content.updateTool(target, {
          isLoading: event.endsWith('-start'),
          ...(typeof data.isError === 'boolean' ? { isError: data.isError } : {}),
          ...(data.metadata ? { resultMeta: data.metadata } : {}),
          ...(data.attachments ? { attachments: data.attachments } : {}),
        }, event.endsWith('-complete'));
        return;
      }
      case 'chat:tool-attachment-update':
      case 'chat:subagent-tool-attachment-update': {
        const target = typeof data.toolUseId === 'string' ? this.content.tool(data.toolUseId) : undefined;
        const tool = target ? this.content.readTool(target) : undefined;
        if (!target || !Array.isArray(tool?.attachments) || !data.attachment) return;
        const replacement = data.attachment;
        this.content.updateTool(target, { attachments: tool.attachments.map(attachment =>
          object(attachment)?.pendingId === data.pendingId ? replacement : attachment) });
        return;
      }
    }
  }
}

function object(value: unknown): TranscriptObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as TranscriptObject : undefined;
}

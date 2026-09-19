import type { MessageUsage, SessionMessage } from './types/session-message';

/** The product transcript is independent of each runtime's model context. */
export const SESSION_TRANSCRIPT_VERSION = 2;

export type TranscriptJson = null | boolean | number | string | TranscriptJson[] | TranscriptObject;
export type TranscriptObject = { [key: string]: TranscriptJson | undefined };
export type TranscriptBlock = TranscriptObject & { id: string; type: string };
export type TranscriptContent = string | TranscriptBlock[];
export type TranscriptMessage = Omit<SessionMessage, 'content'> & { content: TranscriptContent };
export type TranscriptMessageDetails = Omit<TranscriptMessage, 'id' | 'role' | 'content' | 'timestamp'>;

export interface TranscriptTurn {
  id: string;
  rootUserMessageId: string;
  startedAt: string;
  status: 'running' | 'complete' | 'stopped' | 'error' | 'interrupted';
  usage?: MessageUsage;
  durationMs?: number;
}

export type TranscriptTextTarget = {
  messageId: string;
  blockId?: string;
  /** A nested call belongs to its parent's block, even after another user speaks. */
  subagentToolId?: string;
  field: 'text' | 'thinking' | 'inputJson' | 'result';
};

/** Named content operations; this is deliberately not arbitrary JSON Patch. */
export type TranscriptOperation =
  | { kind: 'message-create'; message: TranscriptMessage }
  | { kind: 'message-update'; messageId: string; details: Partial<TranscriptMessageDetails>; clear?: (keyof TranscriptMessageDetails)[] }
  | { kind: 'content-confirm'; messageId: string; content: TranscriptContent }
  | { kind: 'block-upsert'; messageId: string; block: TranscriptBlock }
  | { kind: 'blocks-remove'; messageId: string; blockIds: string[] }
  | { kind: 'block-update'; messageId: string; blockId: string; target: 'block' | 'tool'; subagentToolId?: string; details: TranscriptObject }
  | { kind: 'subagents-remove'; messageId: string; blockId: string; toolIds: string[] }
  | { kind: 'subagent-upsert'; messageId: string; blockId: string; call: TranscriptObject & { id: string } }
  | ({ kind: 'text-append'; offset: number; text: string } & TranscriptTextTarget)
  | { kind: 'messages-remove'; messageIds: string[] }
  | { kind: 'turn-update'; turn: TranscriptTurn };

export interface TranscriptProjection {
  /** Map insertion order is display order; timestamps never reorder messages. */
  messages: Map<string, TranscriptMessage>;
  turns: Map<string, TranscriptTurn>;
}

export function createTranscriptProjection(): TranscriptProjection {
  return { messages: new Map(), turns: new Map() };
}

export class TranscriptContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptContentError';
  }
}

function requireMessage(projection: TranscriptProjection, id: string): TranscriptMessage {
  const message = projection.messages.get(id);
  if (!message) throw new TranscriptContentError(`Unknown transcript message: ${id}`);
  return message;
}

function object(value: TranscriptJson | undefined): TranscriptObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function textContainer(message: TranscriptMessage, target: TranscriptTextTarget): TranscriptObject {
  if (!target.blockId || typeof message.content === 'string') {
    throw new TranscriptContentError('Text target has no content block');
  }
  const block = message.content.find(candidate => candidate.id === target.blockId);
  if (!block) throw new TranscriptContentError(`Unknown transcript block: ${target.blockId}`);
  if (target.field === 'text' || target.field === 'thinking') return block;
  const tool = object(block.tool);
  if (!tool) throw new TranscriptContentError('Text target is not a tool');
  if (!target.subagentToolId) return tool;
  const calls = tool.subagentCalls;
  const call = Array.isArray(calls)
    ? calls.map(object).find(candidate => candidate?.id === target.subagentToolId)
    : undefined;
  if (!call) throw new TranscriptContentError(`Unknown nested tool: ${target.subagentToolId}`);
  return call;
}

export function getTranscriptText(projection: TranscriptProjection, target: TranscriptTextTarget): string {
  const message = requireMessage(projection, target.messageId);
  if (!target.blockId && target.field === 'text' && typeof message.content === 'string') {
    return message.content;
  }
  const value = textContainer(message, target)[target.field];
  if (value !== undefined && typeof value !== 'string') {
    throw new TranscriptContentError('Transcript append target is not text');
  }
  return value ?? '';
}

/**
 * Mutates only this projection. Inputs are detached so later adapter updates
 * cannot retroactively alter an enqueued batch or the already-folded prefix.
 * The same operation semantics serve live state, cold reads and the UI.
 */
export function applyTranscriptOperation(projection: TranscriptProjection, operation: TranscriptOperation): void {
  switch (operation.kind) {
    case 'message-create': {
      if (projection.messages.has(operation.message.id)) {
        throw new TranscriptContentError(`Duplicate transcript message: ${operation.message.id}`);
      }
      projection.messages.set(operation.message.id, structuredClone(operation.message));
      break;
    }
    case 'message-update': {
      const message = requireMessage(projection, operation.messageId);
      const updated = { ...message, ...structuredClone(operation.details) };
      for (const key of operation.clear ?? []) delete updated[key];
      projection.messages.set(message.id, updated);
      break;
    }
    case 'content-confirm': {
      const message = requireMessage(projection, operation.messageId);
      projection.messages.set(message.id, { ...message, content: structuredClone(operation.content) });
      break;
    }
    case 'block-upsert': {
      const message = requireMessage(projection, operation.messageId);
      if (typeof message.content === 'string') {
        if (message.content.length > 0) throw new TranscriptContentError('Block would replace unconfirmed plain text');
      }
      const block = structuredClone(operation.block);
      const content = typeof message.content === 'string' ? [] : [...message.content];
      const index = content.findIndex(candidate => candidate.id === block.id);
      if (index < 0) content.push(block);
      else content[index] = block;
      projection.messages.set(message.id, { ...message, content });
      break;
    }
    case 'subagents-remove': {
      const message = requireMessage(projection, operation.messageId);
      if (!Array.isArray(message.content)) throw new TranscriptContentError('Nested removal has no block');
      const block = message.content.find(block => block.id === operation.blockId);
      const tool = object(block?.tool);
      if (!tool || !Array.isArray(tool.subagentCalls)) throw new TranscriptContentError('Nested removal has no calls');
      const removed = new Set(operation.toolIds);
      const updated = { ...block!, tool: { ...tool, subagentCalls: tool.subagentCalls.filter(call => !removed.has(String(object(call)?.id))) } };
      projection.messages.set(message.id, { ...message, content: message.content.map(block => block.id === operation.blockId ? updated : block) });
      break;
    }
    case 'subagent-upsert': {
      const message = requireMessage(projection, operation.messageId);
      if (typeof message.content === 'string') throw new TranscriptContentError('Nested call has no parent block');
      const content = [...message.content];
      const index = content.findIndex(block => block.id === operation.blockId);
      const tool = object(content[index]?.tool);
      if (!tool) throw new TranscriptContentError('Nested call has no parent tool');
      const calls = Array.isArray(tool.subagentCalls) ? [...tool.subagentCalls] : [];
      const callIndex = calls.findIndex(call => object(call)?.id === operation.call.id);
      const call = structuredClone(operation.call);
      if (callIndex < 0) calls.push(call);
      else calls[callIndex] = call;
      content[index] = { ...content[index], tool: { ...tool, subagentCalls: calls } };
      projection.messages.set(message.id, { ...message, content });
      break;
    }
    case 'blocks-remove': {
      const message = requireMessage(projection, operation.messageId);
      if (typeof message.content === 'string') throw new TranscriptContentError('Block removal has no blocks');
      const removed = new Set(operation.blockIds);
      projection.messages.set(message.id, { ...message, content: message.content.filter(block => !removed.has(block.id)) });
      break;
    }
    case 'block-update': {
      const message = requireMessage(projection, operation.messageId);
      if (typeof message.content === 'string') throw new TranscriptContentError('Block update has no block');
      const content = [...message.content];
      const index = content.findIndex(block => block.id === operation.blockId);
      if (index < 0) throw new TranscriptContentError('Unknown transcript block');
      const details = structuredClone(operation.details);
      if ('id' in details || 'type' in details || 'tool' in details) throw new TranscriptContentError('Block update cannot replace identity');
      const block = { ...content[index] };
      if (operation.target === 'block') Object.assign(block, details);
      else {
        const tool = object(block.tool);
        if (!tool) throw new TranscriptContentError('Tool update has no tool');
        if (operation.subagentToolId) {
          if (!Array.isArray(tool.subagentCalls)) throw new TranscriptContentError('Tool update has no nested call');
          let found = false;
          const subagentCalls = tool.subagentCalls.map(call => {
            if (object(call)?.id !== operation.subagentToolId) return call;
            found = true;
            return { ...object(call), ...details };
          });
          if (!found) throw new TranscriptContentError('Unknown nested tool');
          block.tool = { ...tool, subagentCalls };
        } else block.tool = { ...tool, ...details };
      }
      content[index] = block;
      projection.messages.set(message.id, { ...message, content });
      break;
    }
    case 'text-append': {
      const previous = getTranscriptText(projection, operation);
      // Offsets are UTF-16 code units, matching JS string length and UI text.
      if (operation.offset !== previous.length) throw new TranscriptContentError('Non-contiguous transcript text');
      const previousMessage = requireMessage(projection, operation.messageId);
      const message = { ...previousMessage };
      if (!operation.blockId) message.content = previous + operation.text;
      else {
        const content = [...previousMessage.content as TranscriptBlock[]];
        const index = content.findIndex(block => block.id === operation.blockId);
        const block = { ...content[index] };
        content[index] = block;
        message.content = content;
        if (operation.field === 'inputJson' || operation.field === 'result') {
          const tool = { ...object(block.tool) };
          block.tool = tool;
          if (operation.subagentToolId && Array.isArray(tool.subagentCalls)) {
            tool.subagentCalls = tool.subagentCalls.map(call => {
              const value = object(call);
              return value?.id === operation.subagentToolId ? { ...value } : call;
            });
          }
        }
        textContainer(message, operation)[operation.field] = previous + operation.text;
      }
      projection.messages.set(message.id, message);
      break;
    }
    case 'messages-remove':
      for (const id of operation.messageIds) projection.messages.delete(id);
      for (const [id, turn] of projection.turns) if (operation.messageIds.includes(turn.rootUserMessageId)) projection.turns.delete(id);
      break;
    case 'turn-update':
      projection.turns.set(operation.turn.id, structuredClone(operation.turn));
      break;
    default:
      throw new TranscriptContentError('Unknown transcript operation');
  }
}

/** A bad operation must not expose half a batch as a valid recovered prefix. */
export function applyTranscriptBatch(projection: TranscriptProjection, operations: readonly TranscriptOperation[]): void {
  const priorMessages = new Map<string, TranscriptMessage | undefined>();
  const priorTurns = new Map<string, TranscriptTurn | undefined>();
  const priorOrder = operations.some(operation => operation.kind === 'messages-remove')
    ? [...projection.messages.keys()]
    : undefined;
  for (const operation of operations) {
    if (operation.kind === 'messages-remove') {
      for (const [id, turn] of projection.turns) {
        if (operation.messageIds.includes(turn.rootUserMessageId) && !priorTurns.has(id)) priorTurns.set(id, turn);
      }
    }
    const ids = operation.kind === 'message-create' ? [operation.message.id]
      : operation.kind === 'messages-remove' ? operation.messageIds
        : operation.kind === 'turn-update' ? [] : [operation.messageId];
    for (const id of ids) {
      if (!priorMessages.has(id)) priorMessages.set(id, projection.messages.get(id));
    }
    if (operation.kind === 'turn-update' && !priorTurns.has(operation.turn.id)) {
      priorTurns.set(operation.turn.id, projection.turns.get(operation.turn.id));
    }
  }
  try {
    for (const operation of operations) applyTranscriptOperation(projection, operation);
  } catch (error) {
    for (const [id, message] of priorMessages) {
      if (message) projection.messages.set(id, message);
      else projection.messages.delete(id);
    }
    if (priorOrder) projection.messages = new Map(priorOrder.map(id => [id, projection.messages.get(id)!]));
    for (const [id, turn] of priorTurns) {
      if (turn) projection.turns.set(id, turn);
      else projection.turns.delete(id);
    }
    throw error;
  }
}

export function toStoredTranscriptMessage(message: TranscriptMessage): SessionMessage {
  return {
    ...message,
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content.map(block => {
      const tool = object(block.tool);
      return tool ? { ...block, tool: projectTranscriptToolInput(tool) } : block;
    })),
  };
}

export function projectTranscriptToolInput(tool: TranscriptObject): TranscriptObject {
  let input = tool.input;
  if (tool.inputComplete === true && typeof tool.inputJson === 'string') {
    try { input = JSON.parse(tool.inputJson) as TranscriptJson; } catch { /* Unfinished input remains available as inputJson. */ }
  }
  return {
    ...tool, input,
    ...(Array.isArray(tool.subagentCalls) ? {
      subagentCalls: tool.subagentCalls.map(call => object(call) ? projectTranscriptToolInput(object(call)!) : call),
    } : {}),
  };
}

/** Assign product block identities once when importing an existing message. */
export function fromStoredTranscriptMessage(message: SessionMessage): TranscriptMessage {
  let content: TranscriptContent = message.content;
  if (message.content.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(message.content);
      if (Array.isArray(parsed) && parsed.every(value => value && typeof value === 'object' && typeof value.type === 'string')) {
        content = parsed.map((block, index) => ({
          ...block, id: typeof block.id === 'string' ? block.id : `${message.id}:block:${index}`,
          ...(object(block.tool) ? { tool: importToolInput(object(block.tool)!) } : {}),
        }));
      }
    } catch {
      // Legacy plain text that starts with '[' remains plain text on fork.
    }
  }
  return { ...message, content };
}

function importToolInput(tool: TranscriptObject): TranscriptObject {
  const input = object(tool.input);
  const hasConfirmedInput = input && (Object.keys(input).length > 0 || !tool.inputJson);
  return {
    ...tool,
    ...(hasConfirmedInput ? { input: {}, inputJson: JSON.stringify(input), inputComplete: true } : {}),
    ...(Array.isArray(tool.subagentCalls) ? {
      subagentCalls: tool.subagentCalls.map(call => object(call) ? importToolInput(object(call)!) : call),
    } : {}),
  };
}

export function transcriptMessages(projection: TranscriptProjection): SessionMessage[] {
  return [...projection.messages.values()].map(toStoredTranscriptMessage);
}

export interface TranscriptSaveStatus {
  sessionId: string;
  /** Save instance identity; never confused with the runtime's native turn. */
  instanceId: string;
  generation: string;
  liveRevision: number;
  durableRevision: number;
  state: 'healthy' | 'retrying' | 'degraded';
  incidentId?: string;
  reason?: 'io' | 'timeout' | 'invalid-history';
}

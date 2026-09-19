import { createHash } from 'node:crypto';
import {
  SESSION_TRANSCRIPT_VERSION,
  applyTranscriptBatch,
  createTranscriptProjection,
  type TranscriptOperation,
  type TranscriptProjection,
} from '../../shared/sessionTranscript';

export const TRANSCRIPT_MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface TranscriptHeader {
  kind: 'session-transcript';
  version: typeof SESSION_TRANSCRIPT_VERSION;
  sessionId: string;
  generation: string;
  /** A named replacement baseline covers the source projection through this revision. */
  baseRevision: number;
  baseline: boolean;
  sourceGeneration?: string;
}

export interface TranscriptBatch {
  id: string;
  mode: 'delta' | 'baseline';
  fromRevision: number;
  revision: number;
  operations: TranscriptOperation[];
  baselineEnd?: true;
}

function checksum(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function encodeTranscriptBatch(batch: TranscriptBatch): string {
  const body = JSON.stringify(batch);
  const line = `{"batch":${body},"checksum":"${checksum(body)}"}\n`;
  if (Buffer.byteLength(line) > TRANSCRIPT_MAX_LINE_BYTES) throw new Error('Transcript batch exceeds line limit');
  return line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isContent(value: unknown): boolean {
  return typeof value === 'string' || (Array.isArray(value) && value.every(block =>
    isRecord(block) && typeof block.id === 'string' && typeof block.type === 'string'));
}

const MESSAGE_DETAILS = new Set([
  'asyncQuestionReply', 'sdkUuid', 'runtimeTurnAnchor', 'attachments', 'usage',
  'toolCount', 'durationMs', 'metadata', 'turnId', 'transcriptState',
]);

function isOperation(value: unknown): value is TranscriptOperation {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'message-create': {
      const message = value.message;
      return isRecord(message) && typeof message.id === 'string'
        && (message.role === 'user' || message.role === 'assistant')
        && typeof message.timestamp === 'string' && isContent(message.content);
    }
    case 'message-update':
      return typeof value.messageId === 'string' && isRecord(value.details)
        && Object.keys(value.details).every(key => MESSAGE_DETAILS.has(key))
        && (value.clear === undefined || (Array.isArray(value.clear)
          && value.clear.every(key => typeof key === 'string' && MESSAGE_DETAILS.has(key))));
    case 'content-confirm':
      return typeof value.messageId === 'string' && isContent(value.content);
    case 'block-upsert':
      return typeof value.messageId === 'string' && isRecord(value.block)
        && typeof value.block.id === 'string' && typeof value.block.type === 'string';
    case 'blocks-remove':
      return typeof value.messageId === 'string' && Array.isArray(value.blockIds) && value.blockIds.every(id => typeof id === 'string');
    case 'text-append':
      return typeof value.messageId === 'string' && typeof value.text === 'string'
        && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0
        && ['text', 'thinking', 'inputJson', 'result'].includes(value.field as string)
        && (value.blockId === undefined || typeof value.blockId === 'string')
        && (value.subagentToolId === undefined || typeof value.subagentToolId === 'string');
    case 'block-update':
      return typeof value.messageId === 'string' && typeof value.blockId === 'string'
        && (value.target === 'block' || value.target === 'tool') && isRecord(value.details)
        && !['id', 'type', 'tool'].some(key => key in (value.details as Record<string, unknown>))
        && (value.subagentToolId === undefined || (value.target === 'tool' && typeof value.subagentToolId === 'string'));
    case 'subagents-remove':
      return typeof value.messageId === 'string' && typeof value.blockId === 'string'
        && Array.isArray(value.toolIds) && value.toolIds.every(id => typeof id === 'string');
    case 'subagent-upsert':
      return typeof value.messageId === 'string' && typeof value.blockId === 'string'
        && isRecord(value.call) && typeof value.call.id === 'string';
    case 'messages-remove':
      return Array.isArray(value.messageIds) && value.messageIds.every(id => typeof id === 'string');
    case 'turn-update': {
      const turn = value.turn;
      return isRecord(turn) && typeof turn.id === 'string' && typeof turn.rootUserMessageId === 'string'
        && typeof turn.startedAt === 'string'
        && ['running', 'complete', 'stopped', 'error', 'interrupted'].includes(turn.status as string);
    }
    default:
      return false;
  }
}

export function decodeTranscriptBatch(line: string): TranscriptBatch {
  if (Buffer.byteLength(line) > TRANSCRIPT_MAX_LINE_BYTES) throw new Error('Transcript line exceeds limit');
  // Hash the actual batch bytes. Re-serializing parsed JSON is not portable:
  // another reader can use a different object key order or number spelling.
  const suffix = /,"checksum":"([a-f0-9]{64})"\}$/.exec(line);
  const body = suffix && line.startsWith('{"batch":') ? line.slice(9, suffix.index) : null;
  if (!body || !suffix || suffix[1] !== checksum(body)) {
    throw new Error('Invalid transcript batch checksum');
  }
  const batch: unknown = JSON.parse(body);
  if (!isRecord(batch)) throw new Error('Invalid transcript batch schema');
  if (typeof batch.id !== 'string' || !Number.isSafeInteger(batch.revision)
    || (batch.revision as number) < 0 || !Number.isSafeInteger(batch.fromRevision)
    || (batch.fromRevision as number) < 0
    || (batch.mode !== 'delta' && batch.mode !== 'baseline') || !Array.isArray(batch.operations)
    || !batch.operations.every(isOperation)) throw new Error('Invalid transcript batch schema');
  return batch as unknown as TranscriptBatch;
}

export function decodeTranscriptHeader(line: string, sessionId: string): TranscriptHeader {
  const header: unknown = JSON.parse(line);
  if (!isRecord(header) || header.kind !== 'session-transcript'
    || header.version !== SESSION_TRANSCRIPT_VERSION || header.sessionId !== sessionId
    || typeof header.generation !== 'string' || !header.generation
    || !Number.isSafeInteger(header.baseRevision) || (header.baseRevision as number) < 0
    || typeof header.baseline !== 'boolean') {
    throw new Error('Invalid or unsupported transcript header');
  }
  return header as unknown as TranscriptHeader;
}

export interface DecodedTranscript {
  header: TranscriptHeader;
  projection: TranscriptProjection;
  revision: number;
  lastBatchId: string | null;
  validBytes: number;
  tail: 'clean' | 'incomplete' | 'invalid';
}

/** Incremental decoding lets file IO yield between bounded records. */
export class TranscriptDecoder {
  private result: DecodedTranscript | null = null;
  private baselineComplete = false;

  constructor(private readonly sessionId: string) {}

  push(line: string): boolean {
    if (!this.result) {
      const header = decodeTranscriptHeader(line, this.sessionId);
      this.baselineComplete = !header.baseline;
      this.result = {
        header, projection: createTranscriptProjection(), revision: header.baseRevision,
        lastBatchId: null, validBytes: Buffer.byteLength(line) + 1, tail: 'clean',
      };
      return true;
    }
    const result = this.result;
    if (result.tail !== 'clean') return false;
    try {
      const batch = decodeTranscriptBatch(line);
      if (batch.mode === 'baseline') {
        if (this.baselineComplete || batch.revision !== result.header.baseRevision || batch.fromRevision !== 0) {
          throw new Error('Invalid transcript baseline');
        }
      } else if (!this.baselineComplete || batch.fromRevision !== result.revision + 1 || batch.revision < batch.fromRevision) {
        throw new Error('Non-contiguous transcript revision');
      }
      applyTranscriptBatch(result.projection, batch.operations);
      if (batch.mode === 'baseline' && batch.baselineEnd) this.baselineComplete = true;
      result.revision = batch.revision;
      result.lastBatchId = batch.id;
      result.validBytes += Buffer.byteLength(line) + 1;
    } catch {
      result.tail = 'invalid';
      return false;
    }
    return true;
  }

  finish(incomplete = false): DecodedTranscript {
    if (!this.result) throw new Error('Incomplete transcript header');
    if (!this.baselineComplete) throw new Error('Incomplete transcript baseline');
    if (incomplete && this.result.tail === 'clean') this.result.tail = 'incomplete';
    return this.result;
  }
}

/** Read only the valid prefix; never skip a malformed middle row. */
export function decodeTranscript(text: string, sessionId: string): DecodedTranscript {
  const decoder = new TranscriptDecoder(sessionId);
  let offset = 0;
  while (offset < text.length) {
    const end = text.indexOf('\n', offset);
    if (end < 0) return decoder.finish(true);
    if (!decoder.push(text.slice(offset, end))) break;
    offset = end + 1;
  }
  return decoder.finish();
}

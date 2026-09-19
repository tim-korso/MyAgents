import { randomUUID } from 'node:crypto';
import {
  applyTranscriptOperation,
  type TranscriptOperation,
  type TranscriptProjection,
  type TranscriptSaveStatus,
} from '../../shared/sessionTranscript';
import type { TranscriptBatch } from './codec';

export const TRANSCRIPT_BATCH_MS = 100;
export const TRANSCRIPT_BATCH_BYTES = 256 * 1024;
const HEALTH_TIMEOUT_MS = 10_000;
const RETRY_MS = [500, 1500, 5000, 15_000, 30_000];

export class TranscriptStorageError extends Error {
  constructor(readonly reason: 'io' | 'invalid-history', message: string) {
    super(message);
    this.name = 'TranscriptStorageError';
  }
}

export interface TranscriptCommitTarget {
  generation: string;
  revision: number;
}

/** Implemented inside SessionStore's file/metadata ownership boundary. */
export interface TranscriptStorage {
  append(expected: TranscriptCommitTarget, batch: TranscriptBatch): Promise<void>;
  replace(expected: TranscriptCommitTarget, snapshot: TranscriptProjection, revision: number): Promise<TranscriptCommitTarget>;
  discardCandidate?(): Promise<void>;
}

type QueuedOperation = { operation?: TranscriptOperation; revision: number; fromRevision?: number; bytes: number };

export interface TranscriptWriterOptions {
  sessionId: string;
  generation: string;
  revision: number;
  projection: TranscriptProjection;
  storage: TranscriptStorage;
  onStatus?: (status: TranscriptSaveStatus) => void;
}

/**
 * A Session-owned write-behind queue. Nothing here owns Runtime admission or
 * terminal state. A timed-out write retains exclusive physical ownership until
 * its promise settles; the content producer continues independently.
 */
export class TranscriptWriter {
  readonly projection: TranscriptProjection;
  private readonly instanceId = randomUUID();
  private generation: string;
  private liveRevision: number;
  private durableRevision: number;
  private recoveryRevision = 0;
  private queue: QueuedOperation[] = [];
  private queuedBytes = 0;
  private needsBaseline = false;
  private recordingComplete = true;
  private closed = false;
  private retiring = false;
  private blocked = false;
  private inFlight: Promise<void> | null = null;
  private retryBatch: TranscriptBatch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private state: TranscriptSaveStatus['state'] = 'healthy';
  private incidentId: string | undefined;
  private reason: TranscriptSaveStatus['reason'];
  private readonly waiters = new Set<() => void>();
  private readonly observers = new Set<(operation: TranscriptOperation) => void>();

  constructor(private readonly options: TranscriptWriterOptions) {
    this.projection = options.projection;
    this.generation = options.generation;
    this.liveRevision = options.revision;
    this.durableRevision = options.revision;
  }

  get status(): TranscriptSaveStatus {
    return {
      sessionId: this.options.sessionId, instanceId: this.instanceId,
      generation: this.generation, liveRevision: this.liveRevision,
      durableRevision: this.durableRevision, state: this.state,
      ...(this.incidentId ? { incidentId: this.incidentId } : {}),
      ...(this.reason ? { reason: this.reason } : {}),
    };
  }

  get diagnostics(): { queuedBytes: number; inFlight: boolean; needsBaseline: boolean } {
    return { queuedBytes: this.queuedBytes, inFlight: this.inFlight !== null, needsBaseline: this.needsBaseline };
  }

  subscribeOperations(observer: (operation: TranscriptOperation) => void): () => void {
    if (this.closed) return () => undefined;
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  /** No disk promise escapes into a content producer. */
  observe(operation: TranscriptOperation, boundary = false): void {
    if (this.closed) return;
    try {
      applyTranscriptOperation(this.projection, operation);
      this.liveRevision += 1;
      this.publishOperation(operation);
      const detached = structuredClone(operation);
      const bytes = Buffer.byteLength(JSON.stringify(detached));
      // Retain every pending operation during slow/failed IO. The queue has no
      // capacity policy: memory growth during a prolonged fault is accepted,
      // and neither recording nor Runtime admission depends on its size.
      if (!this.needsBaseline) {
        this.queue.push({ operation: detached, revision: this.liveRevision, bytes });
        this.queuedBytes += bytes;
      }
      this.watchHealth();
      // A full batch can start before the next timer. Filesystem work starts
      // in a microtask so the content producer never awaits it.
      if (this.queuedBytes >= TRANSCRIPT_BATCH_BYTES && this.retryAttempt === 0 && !this.needsBaseline) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.startWrite();
      } else this.schedule(boundary ? 0 : TRANSCRIPT_BATCH_MS);
    } catch {
      // An unrepresentable observation is a recording fault, never an AI abort.
      // The snapshot is no longer eligible to replace an existing history.
      this.recordingComplete = false;
      this.blocked = true;
      this.fail('invalid-history', 'degraded');
    }
  }

  /** Birth/metadata publication shares the serial IO queue without inventing a content event. */
  requestCommit(): void {
    if (this.closed || this.blocked) return;
    this.liveRevision += 1;
    // Adjacent metadata changes need only one barrier and never grow the queue.
    if (!this.needsBaseline) {
      const last = this.queue.at(-1);
      if (last && !last.operation) last.revision = this.liveRevision;
      else this.queue.push({ revision: this.liveRevision, fromRevision: this.liveRevision, bytes: 0 });
    }
    this.watchHealth();
    this.schedule(TRANSCRIPT_BATCH_MS);
  }

  /** SessionStore has already checked a named mutation's lifecycle and source cursor. */
  replaceProjection(projection: TranscriptProjection): void {
    if (this.closed || this.blocked || !this.recordingComplete) throw new TranscriptStorageError('invalid-history', 'Transcript is not a complete mutation source');
    const removedIds = [...this.projection.messages.keys()].filter(id => !projection.messages.has(id));
    this.projection.messages.clear();
    this.projection.turns.clear();
    for (const [id, message] of projection.messages) this.projection.messages.set(id, message);
    for (const [id, turn] of projection.turns) this.projection.turns.set(id, turn);
    this.liveRevision += 1;
    this.queue = [];
    this.queuedBytes = 0;
    this.needsBaseline = true;
    // The same membership event updates adapter identities and live surfaces.
    // It belongs to this replacement revision, not a second persisted edit.
    if (removedIds.length) this.publishOperation({ kind: 'messages-remove', messageIds: removedIds });
    this.watchHealth();
    this.schedule(0);
  }

  private publishOperation(operation: TranscriptOperation): void {
    for (const observer of this.observers) {
      try { observer(operation); } catch { /* A disconnected surface does not own recording or execution. */ }
    }
  }

  /** A damaged cold source may be displayed, but cannot become a new baseline. */
  rejectIncompleteSource(): void {
    this.recordingComplete = false;
    this.blocked = true;
    this.fail('invalid-history', 'degraded');
  }

  private emit(): void {
    try { this.options.onStatus?.(this.status); } catch { /* UI notification does not own a commit. */ }
    for (const wake of this.waiters) wake();
  }

  private fail(reason: NonNullable<TranscriptSaveStatus['reason']>, state: TranscriptSaveStatus['state']): void {
    this.recoveryRevision = Math.max(this.recoveryRevision, this.liveRevision);
    const changed = this.state !== state || this.reason !== reason;
    if (this.state === 'healthy' || !this.incidentId) this.incidentId = randomUUID();
    this.reason = reason;
    this.state = state;
    if (changed) {
      console.warn(`[session-transcript] session=${this.options.sessionId} state=${state} reason=${reason} queuedBytes=${this.queuedBytes} liveRevision=${this.liveRevision} durableRevision=${this.durableRevision}`);
      this.emit();
    }
  }

  private watchHealth(): void {
    if (this.healthTimer || this.closed || this.blocked || this.liveRevision === this.durableRevision) return;
    this.healthTimer = setTimeout(() => {
      this.healthTimer = null;
      if (this.liveRevision > this.durableRevision) this.fail('timeout', 'degraded');
    }, HEALTH_TIMEOUT_MS);
    this.healthTimer.unref?.();
  }

  private schedule(delay: number): void {
    if (this.closed || this.retiring || this.blocked || this.inFlight) return;
    if (this.timer) {
      if (delay !== 0 || this.retryAttempt > 0) return;
      clearTimeout(this.timer);
    }
    if (!this.needsBaseline && !this.retryBatch && this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.startWrite();
    }, delay);
    this.timer.unref?.();
  }

  private startWrite(): void {
    if (this.inFlight || this.closed || this.retiring || this.blocked) return;
    const expected = { generation: this.generation, revision: this.durableRevision };
    let work: Promise<void>;
    let targetRevision: number;
    let batch: TranscriptBatch | null = this.retryBatch;
    if (batch) {
      targetRevision = batch.revision;
      work = Promise.resolve().then(() => this.options.storage.append(expected, batch!));
    } else if (this.needsBaseline) {
      if (!this.recordingComplete) return;
      // Values are immutable across reducer updates; only map membership is copied.
      const snapshot = { messages: new Map(this.projection.messages), turns: new Map(this.projection.turns) };
      targetRevision = this.liveRevision;
      this.queue = [];
      this.queuedBytes = 0;
      this.needsBaseline = false;
      work = Promise.resolve().then(async () => {
        const committed = await this.options.storage.replace(expected, snapshot, targetRevision);
        this.generation = committed.generation;
        if (committed.revision < targetRevision) this.needsBaseline = true;
        targetRevision = committed.revision;
      });
    } else {
      if (this.queue.length === 0) return;
      let count = 0;
      let bytes = 0;
      while (count < this.queue.length && (count === 0 || bytes + this.queue[count].bytes <= TRANSCRIPT_BATCH_BYTES)) {
        bytes += this.queue[count].bytes;
        count += 1;
      }
      const pending = this.queue.splice(0, count);
      this.queuedBytes -= bytes;
      targetRevision = pending[pending.length - 1].revision;
      batch = {
        id: randomUUID(), mode: 'delta', fromRevision: pending[0].fromRevision ?? pending[0].revision,
        revision: targetRevision, operations: pending.flatMap(entry => entry.operation ? [entry.operation] : []),
      };
      work = Promise.resolve().then(() => this.options.storage.append(expected, batch!));
    }

    const task = work.then(() => {
      this.durableRevision = targetRevision;
      this.retryBatch = null;
      this.retryAttempt = 0;
      if (this.healthTimer) clearTimeout(this.healthTimer);
      this.healthTimer = null;
      if (!this.needsBaseline && this.recordingComplete && this.durableRevision >= this.recoveryRevision) {
        this.state = 'healthy';
        this.reason = undefined;
      }
      this.emit();
    }).catch(error => {
      if (error instanceof TranscriptStorageError && error.reason === 'invalid-history') {
        this.blocked = true;
        this.fail('invalid-history', 'degraded');
      } else {
        // Exact batch identity survives a sync/ack failure; later operations
        // stay queued until this batch has been confirmed.
        if (batch) this.retryBatch = batch;
        else this.needsBaseline = true;
        this.fail('io', this.needsBaseline ? 'degraded' : 'retrying');
      }
      this.retryAttempt += 1;
    }).finally(() => {
      if (this.inFlight === task) this.inFlight = null;
      this.watchHealth();
      this.schedule(this.retryAttempt ? RETRY_MS[Math.min(this.retryAttempt - 1, RETRY_MS.length - 1)] : 0);
    });
    this.inFlight = task;
  }

  /** Explicit edits wait for physical IO, not a wall-clock guess. A real IO
   * failure returns control; the existing background writer retains its retry. */
  async flushForMutation(): Promise<boolean> {
    const target = this.liveRevision;
    while (this.durableRevision < target) {
      if (this.closed || this.blocked || this.retiring) return false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.startWrite();
      const writing = this.inFlight;
      if (!writing) return false;
      await writing;
      if (this.retryAttempt > 0) return false;
    }
    return !this.closed && !this.blocked;
  }

  /** Bounded flush for lifecycle callers. Timeout never cancels the physical IO. */
  async flush(timeoutMs = 2000): Promise<boolean> {
    const target = this.liveRevision;
    if (this.closed || this.blocked) return false;
    if (this.durableRevision >= target) return true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.startWrite();
    return new Promise(resolve => {
      const check = () => {
        if (this.durableRevision >= target) finish(true);
        else if (this.closed || this.blocked) finish(false);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (value: boolean) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(value);
      };
      this.waiters.add(check);
      check();
    });
  }

  /** An explicit binding change may discard its uncommitted tail, but cannot
   * leave physical IO behind in a Sidecar now owned by another Session. A
   * deadline failure keeps this writer usable by the unchanged binding. */
  async retire(timeoutMs = 2000): Promise<boolean> {
    if (this.closed) return this.inFlight === null;
    this.retiring = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      (this.inFlight ?? Promise.resolve()).then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!settled) {
      this.retiring = false;
      this.schedule(TRANSCRIPT_BATCH_MS);
      return false;
    }
    // Only an unpublished, uniquely named candidate may remain for cleanup.
    // Its unlink cannot resurrect or mutate the old Session's final path.
    void this.close().catch(error => console.warn('[session-transcript] Candidate cleanup failed:', error));
    return true;
  }

  /** Invalidates producers immediately; callers must still await outstanding IO before replacing/deleting files. */
  close(): Promise<void> {
    this.observers.clear();
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.timer = null;
    this.healthTimer = null;
    this.queue = [];
    this.queuedBytes = 0;
    this.emit();
    return (this.inFlight ?? Promise.resolve()).then(() => this.options.storage.discardCandidate?.());
  }
}

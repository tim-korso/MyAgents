import type { PendingConversationMutation, SessionMetadata } from '../types/session';
import type { TranscriptProjection, TranscriptSaveStatus } from '../../shared/sessionTranscript';
import { TranscriptFile } from './file';
import { TranscriptWriter } from './writer';
import type { TranscriptCommitTarget } from './writer';

export interface SessionTranscriptOptions {
  metadata: SessionMetadata;
  birth: boolean;
  filePath: string;
  generation: string;
  revision: number;
  projection: TranscriptProjection;
  recoverIncompleteTail?: boolean;
  incompleteSource?: boolean;
  withLock: <T>(run: () => Promise<T>) => Promise<T>;
  publishMetadata: (metadata: SessionMetadata, patch: Partial<SessionMetadata>, birth: boolean) => Promise<SessionMetadata>;
  deriveMetadata: (projection: TranscriptProjection) => Pick<SessionMetadata, 'stats' | 'lastMessagePreview'>;
  onStatus: (status: TranscriptSaveStatus) => void;
  publishMutationIntent: (sourceMetadata: SessionMetadata, intent: PendingConversationMutation) => Promise<void>;
}

/** SessionStore's active instance; its metadata overlay has no authority over native execution. */
export class SessionTranscript {
  readonly writer: TranscriptWriter;
  readonly file: TranscriptFile;
  private currentMetadata: SessionMetadata;
  private pendingMetadata: Partial<SessionMetadata> = {};
  private birthPublished: boolean;
  private derivedMetadataDirty = true;
  private revoked = false;
  private mutation: { source: SessionMetadata; intent: PendingConversationMutation; target?: TranscriptCommitTarget } | null = null;

  constructor(private readonly options: SessionTranscriptOptions) {
    this.currentMetadata = structuredClone(options.metadata);
    this.birthPublished = !options.birth;
    this.file = new TranscriptFile({
      sessionId: options.metadata.id, filePath: options.filePath, generation: options.generation,
      allowCreate: options.birth, recoverIncompleteTail: options.recoverIncompleteTail,
      withLock: options.withLock, publishBirth: target => this.publishMetadata(target),
      prepareReplacement: async (source, target) => {
        if (!this.mutation) return;
        this.mutation.target = target;
        await options.publishMutationIntent(this.mutation.source, {
          ...this.mutation.intent,
          transcript: { format: 2, sourceGeneration: source.generation, targetGeneration: target.generation, targetRevision: target.revision },
        });
      },
    });
    this.writer = new TranscriptWriter({
      sessionId: options.metadata.id, generation: options.generation, revision: options.revision,
      projection: options.projection, storage: this.file, onStatus: options.onStatus,
    });
    this.writer.subscribeOperations(operation => {
      // Assistant body/tool deltas cannot change user preview or token totals.
      // Derive only after membership, user text, or accounting changes.
      if (operation.kind === 'message-create' || operation.kind === 'messages-remove'
        || operation.kind === 'turn-update' || operation.kind === 'message-update'
        || ('messageId' in operation && this.writer.projection.messages.get(operation.messageId)?.role === 'user')) {
        this.derivedMetadataDirty = true;
      }
    });
    if (options.incompleteSource) this.writer.rejectIncompleteSource();
    else if (options.birth) this.writer.requestCommit();
  }

  private refreshDerivedMetadata(): void {
    if (!this.derivedMetadataDirty || this.options.incompleteSource) return;
    this.derivedMetadataDirty = false;
    const derived = this.options.deriveMetadata(this.writer.projection);
    this.currentMetadata = { ...this.currentMetadata, ...derived };
    this.pendingMetadata = { ...this.pendingMetadata, ...derived };
  }

  get metadata(): SessionMetadata {
    this.refreshDerivedMetadata();
    return structuredClone(this.currentMetadata);
  }

  /** Reconcile a successful explicit product edit, without queuing it again. */
  adoptPublishedMetadata(updated: SessionMetadata): void {
    this.currentMetadata = { ...updated, ...this.pendingMetadata };
  }
  get hasPendingMutation(): boolean { return this.mutation !== null; }
  get isRevoked(): boolean { return this.revoked; }

  async retire(timeoutMs: number): Promise<boolean> {
    const retired = await this.writer.retire(timeoutMs);
    if (retired) this.revoked = true;
    return retired;
  }

  revoke(): Promise<void> {
    this.revoked = true;
    return this.writer.close();
  }

  beginConversationMutation(intent: PendingConversationMutation, patch: Partial<SessionMetadata>, target: TranscriptProjection): void {
    if (this.mutation) throw new Error('A conversation mutation is still being saved');
    const source = this.metadata;
    this.writer.replaceProjection(target);
    this.derivedMetadataDirty = true;
    this.mutation = { source, intent };
    this.patchMetadata({ ...patch, pendingConversationMutation: undefined });
  }

  patchMetadata(patch: Partial<SessionMetadata>): SessionMetadata {
    if (this.revoked) throw new Error('Session history ownership has been revoked');
    // SessionStore is the only caller and strips format/identity changes.
    const detached = structuredClone(patch);
    this.currentMetadata = { ...this.currentMetadata, ...detached };
    this.pendingMetadata = { ...this.pendingMetadata, ...detached };
    this.writer.requestCommit();
    return this.metadata;
  }

  private async publishMetadata(committed: TranscriptCommitTarget): Promise<void> {
    this.refreshDerivedMetadata();
    const patch = this.pendingMetadata;
    if (this.birthPublished && Object.keys(patch).length === 0) return;
    const updated = await this.options.publishMetadata(this.metadata, patch, !this.birthPublished);
    this.birthPublished = true;
    const remaining = { ...this.pendingMetadata };
    for (const key of Object.keys(patch) as (keyof SessionMetadata)[]) {
      if (remaining[key] === patch[key]) delete remaining[key];
    }
    this.pendingMetadata = remaining;
    this.currentMetadata = { ...updated, ...remaining };
    if (this.mutation?.target?.generation === committed.generation
      && committed.revision >= this.mutation.target.revision) this.mutation = null;
  }
}

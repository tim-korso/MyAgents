import type { AsyncQuestionReply } from '../../shared/asyncUserQuestions';
/** Lightweight image info for queued messages (no File blob to avoid memory leaks) */
export interface QueuedImageInfo {
  id: string;
  name: string;
  preview: string; // data URL for preview display
  mimeType?: string;
  sizeBytes?: number;
  source?: 'inline_base64' | 'attachment_ref';
  relativePath?: string;
}

export interface QueuedMessageInfo {
  asyncQuestionReply?: AsyncQuestionReply;
  queueId: string;
  text: string;                // Original text, for cancel → restore to input
  images?: QueuedImageInfo[];  // Lightweight image info for display and restore
  timestamp: number;
  deliveryMode?: 'realtime' | 'turn';
  /** Defaults to true for legacy/builtin queues. Some runtimes cannot retract accepted input. */
  canCancel?: boolean;
  /** Defaults to true for legacy/builtin queues. Some runtimes cannot force a single accepted input. */
  canForceExecute?: boolean;
  /**
   * True when this queue item has crossed from a purely local queue into the
   * runtime's in-flight path. Whether it is still cancellable/forceable is
   * runtime-specific and represented by canCancel/canForceExecute.
   */
  isInFlight?: boolean;
}

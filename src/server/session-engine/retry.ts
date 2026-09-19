import type { CapabilityOperationResult, DesktopMessageRequest, DesktopRetryOptions, SessionEngineCurrentContext } from './types';

/** Replay the stored user input through ordinary desktop admission. */
export function retryDesktopRequest(context: SessionEngineCurrentContext, rewind: CapabilityOperationResult, options: DesktopRetryOptions = {}): DesktopMessageRequest {
  if (!context.sessionId || !context.workspacePath) throw new Error('Retry session is unavailable');
  return {
    sessionId: context.sessionId, workspacePath: context.workspacePath, scenario: { type: 'desktop' },
    text: rewind.content ?? '',
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    images: rewind.attachments?.filter(attachment => attachment.isImage || attachment.mimeType?.startsWith('image/'))
      .map(attachment => {
        const relativePath = attachment.relativePath || attachment.savedPath;
        if (!relativePath) throw new Error('The original image is unavailable for retry');
        return { kind: 'attachment_ref' as const, id: attachment.id, name: attachment.name,
          mimeType: attachment.mimeType || 'application/octet-stream', relativePath, sizeBytes: attachment.size };
      }),
  };
}

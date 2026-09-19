/** Birth format is immutable; native identity never selects product history. */
export type TranscriptFormatDecision = 'legacy' | 'v2' | 'conflict' | 'unsupported' | 'unindexed';

export function resolveTranscriptFormat(input: {
  metadataExists: boolean;
  transcriptFormat?: unknown;
  legacyFileExists: boolean;
  v2FileExists: boolean;
}): TranscriptFormatDecision {
  if (!input.metadataExists) return 'unindexed';
  if (input.transcriptFormat !== undefined && input.transcriptFormat !== 2) return 'unsupported';
  if (input.transcriptFormat === 2) return input.legacyFileExists ? 'conflict' : 'v2';
  return input.v2FileExists ? 'conflict' : 'legacy';
}

export function isValidProductSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(sessionId) && sessionId.length < 100;
}

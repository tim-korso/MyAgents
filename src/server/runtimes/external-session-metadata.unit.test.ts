import { describe, expect, it } from 'vitest';

import {
  shouldCreateMissingExternalMetadataForRealUserTurn,
  shouldTrackPendingExternalSessionBirth,
} from './external-session';

describe('external session metadata materialization policy', () => {
  it('does not let fresh-start alone recreate missing metadata', () => {
    expect(shouldCreateMissingExternalMetadataForRealUserTurn('fresh-start', false)).toBe(false);
  });

  it('allows first turns only when a pre-warm or IM birth exists', () => {
    expect(shouldCreateMissingExternalMetadataForRealUserTurn('fresh-start', true)).toBe(true);
    expect(shouldCreateMissingExternalMetadataForRealUserTurn('resume-start', true)).toBe(true);
    expect(shouldCreateMissingExternalMetadataForRealUserTurn('active-process', true)).toBe(true);

    expect(shouldCreateMissingExternalMetadataForRealUserTurn('resume-start', false)).toBe(false);
    expect(shouldCreateMissingExternalMetadataForRealUserTurn('active-process', false)).toBe(false);
  });

  it('tracks pending birth only for fresh pre-warm starts without metadata', () => {
    expect(shouldTrackPendingExternalSessionBirth({
      hasInitialMessage: false,
      hasResumeSessionId: false,
      hasMetadata: false,
    })).toBe(true);

    expect(shouldTrackPendingExternalSessionBirth({
      hasInitialMessage: false,
      hasResumeSessionId: true,
      hasMetadata: false,
    })).toBe(false);
    expect(shouldTrackPendingExternalSessionBirth({
      hasInitialMessage: true,
      hasResumeSessionId: false,
      hasMetadata: false,
    })).toBe(false);
    expect(shouldTrackPendingExternalSessionBirth({
      hasInitialMessage: false,
      hasResumeSessionId: false,
      hasMetadata: true,
    })).toBe(false);
  });
});

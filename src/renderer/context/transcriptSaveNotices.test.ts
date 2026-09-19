import { describe, expect, it } from 'vitest';
import type { TranscriptSaveStatus } from '../../shared/sessionTranscript';
import { TranscriptSaveNotices } from './transcriptSaveNotices';

const fault: TranscriptSaveStatus = {
    sessionId: 's1', instanceId: 'sidecar-1', generation: 'g1',
    liveRevision: 20, durableRevision: 5, incidentId: 'failure-1', state: 'retrying', reason: 'io',
};

describe('product save notices', () => {
    it('deduplicates retries, replays and generation replacement within the incident', () => {
        const notices = new TranscriptSaveNotices();
        expect(notices.consume(fault)).toBe('warning');
         expect(notices.consume({ ...fault, state: 'degraded', reason: 'timeout' })).toBeNull();
        expect(notices.consume({ ...fault, generation: 'g2' })).toBeNull();
        expect(notices.consume({ ...fault, state: 'healthy', durableRevision: 20 })).toBe('recovered');
        expect(notices.consume({ ...fault, state: 'healthy', durableRevision: 20 })).toBeNull();
        expect(notices.consume(fault)).toBeNull();
    });

    it('only announces recovery of a fault this window actually displayed', () => {
        const notices = new TranscriptSaveNotices();
        expect(notices.consume({ ...fault, state: 'healthy' })).toBeNull();
        expect(notices.consume(fault)).toBe('warning');
        expect(notices.consume({ ...fault, instanceId: 'sidecar-2', state: 'healthy' })).toBeNull();
        expect(notices.consume({ ...fault, instanceId: 'sidecar-2' })).toBe('warning');
        expect(notices.consume({ ...fault, sessionId: 's2' })).toBe('warning');
        expect(notices.consume({ ...fault, incidentId: 'failure-2' })).toBe('warning');
    });
});

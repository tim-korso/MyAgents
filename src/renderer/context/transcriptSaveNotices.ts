import type { TranscriptSaveStatus } from '../../shared/sessionTranscript';

/** Window-local consumption state; remounting a Tab is not a new incident. */
export class TranscriptSaveNotices {
    private readonly warned = new Set<string>();
    private readonly recovered = new Set<string>();

    consume(status: TranscriptSaveStatus): 'warning' | 'recovered' | null {
        if (!status.incidentId) return null;
        const key = JSON.stringify([status.sessionId, status.instanceId, status.incidentId]);
        if (status.state !== 'healthy') {
            if (this.warned.has(key)) return null;
            this.warned.add(key);
            return 'warning';
        }
        if (!this.warned.has(key) || this.recovered.has(key)) return null;
        this.recovered.add(key);
        return 'recovered';
    }
}

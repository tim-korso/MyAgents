import { describe, expect, it } from 'vitest';

import { derivePetAnimation } from './petStateMapper';

describe('derivePetAnimation', () => {
    it('maps the four MyAgents business states without treating Codex rows as business states', () => {
        expect(derivePetAnimation({ ballState: 'idle' })).toBe('idle');
        expect(derivePetAnimation({ ballState: 'running' })).toBe('running');
        expect(derivePetAnimation({ ballState: 'blocked', pendingKind: 'ask' })).toBe('waiting');
        expect(derivePetAnimation({ ballState: 'done' })).toBe('review');
    });

    it('keeps blocked stronger than running/done by requiring caller to pass the aggregated ball state', () => {
        expect(derivePetAnimation({ ballState: 'blocked', pendingKind: 'permission', donePulse: true })).toBe('waiting');
        expect(derivePetAnimation({ ballState: 'blocked', pendingKind: 'plan' })).toBe('review');
    });

    it('uses one-shot gesture animations without adding new product states', () => {
        expect(derivePetAnimation({ ballState: 'idle', summonPulse: true })).toBe('jumping');
        expect(derivePetAnimation({ ballState: 'done', donePulse: true })).toBe('waving');
    });

    it('uses drag direction before all session-driven states', () => {
        expect(derivePetAnimation({ ballState: 'blocked', dragging: true, dragDirection: 'left' })).toBe('running-left');
        expect(derivePetAnimation({ ballState: 'blocked', dragging: true, dragDirection: 'right' })).toBe('running-right');
        expect(derivePetAnimation({ ballState: 'running', dragging: true, dragDirection: 'none' })).toBe('jumping');
    });

    it('uses failed as an animation layer signal, not a FbBallState enum member', () => {
        expect(derivePetAnimation({ ballState: 'idle', hasError: true })).toBe('failed');
    });
});

import type { CodexPetAnimationName } from './petAtlas';

export type FbBallState = 'idle' | 'running' | 'blocked' | 'done';
export type FbPendingKind = 'permission' | 'ask' | 'plan';
export type PetDragDirection = 'none' | 'left' | 'right';

export interface FloatingPetAnimationInput {
    ballState: FbBallState;
    pendingKind?: FbPendingKind | null;
    dragging?: boolean;
    dragDirection?: PetDragDirection;
    summonPulse?: boolean;
    donePulse?: boolean;
    hasError?: boolean;
}

export function derivePetAnimation(input: FloatingPetAnimationInput): CodexPetAnimationName {
    if (input.dragging) {
        if (input.dragDirection === 'left') return 'running-left';
        if (input.dragDirection === 'right') return 'running-right';
        return 'jumping';
    }
    if (input.hasError) return 'failed';
    if (input.summonPulse) return 'jumping';
    if (input.ballState === 'blocked') {
        return input.pendingKind === 'plan' ? 'review' : 'waiting';
    }
    if (input.ballState === 'running') return 'running';
    if (input.ballState === 'done') return input.donePulse ? 'waving' : 'review';
    return 'idle';
}

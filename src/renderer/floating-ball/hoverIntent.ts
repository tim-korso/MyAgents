export interface FloatingBallHoverIntentState {
    inside: boolean;
    suppressUntilLeave: boolean;
}

export interface FloatingBallHoverGuards {
    hoverEnabled: boolean;
    dragging: boolean;
    companionPinned: boolean;
}

export function createFloatingBallHoverIntentState(): FloatingBallHoverIntentState {
    return {
        inside: false,
        suppressUntilLeave: false,
    };
}

export function resetFloatingBallHoverIntent(state: FloatingBallHoverIntentState): void {
    state.inside = false;
    state.suppressUntilLeave = false;
}

export function suppressHoverPeekUntilBallLeave(state: FloatingBallHoverIntentState): void {
    state.inside = true;
    state.suppressUntilLeave = true;
}

export function enterFloatingBallHover(
    state: FloatingBallHoverIntentState,
    guards: FloatingBallHoverGuards,
): boolean {
    if (state.inside) return false;
    state.inside = true;
    if (!guards.hoverEnabled || guards.dragging || guards.companionPinned || state.suppressUntilLeave) {
        return false;
    }
    return true;
}

export function leaveFloatingBallHover(state: FloatingBallHoverIntentState): boolean {
    const wasInside = state.inside;
    state.inside = false;
    state.suppressUntilLeave = false;
    return wasInside;
}

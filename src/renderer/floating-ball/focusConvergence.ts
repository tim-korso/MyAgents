export interface FocusConvergenceController {
    request(): void;
    cancel(): void;
}

interface FocusConvergenceOptions<T extends HTMLElement> {
    getTarget(): T | null;
    shouldContinue(): boolean;
    isFocused?: (target: T) => boolean;
    maxAttempts?: number;
    minAttempts?: number;
    requestAnimationFrame?: typeof window.requestAnimationFrame;
    cancelAnimationFrame?: typeof window.cancelAnimationFrame;
}

const DEFAULT_MAX_ATTEMPTS = 24;

function defaultIsFocused(target: HTMLElement): boolean {
    const doc = target.ownerDocument;
    const documentHasFocus = typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;
    return doc.activeElement === target && documentHasFocus;
}

function focusWithoutScroll(target: HTMLElement): void {
    try {
        target.focus({ preventScroll: true });
    } catch {
        target.focus();
    }
}

export function createFocusConvergence<T extends HTMLElement>({
    getTarget,
    shouldContinue,
    isFocused = defaultIsFocused,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    minAttempts = 1,
    requestAnimationFrame = window.requestAnimationFrame.bind(window),
    cancelAnimationFrame = window.cancelAnimationFrame.bind(window),
}: FocusConvergenceOptions<T>): FocusConvergenceController {
    let requestSeq = 0;
    let frameId: number | null = null;

    const clearFrame = () => {
        if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
    };

    const schedule = (fn: FrameRequestCallback) => {
        frameId = requestAnimationFrame((time) => {
            frameId = null;
            fn(time);
        });
    };

    return {
        request() {
            const seq = ++requestSeq;
            let attempts = 0;
            clearFrame();

            const step = () => {
                if (seq !== requestSeq || !shouldContinue()) return;
                const target = getTarget();
                if (!target) return;

                focusWithoutScroll(target);
                attempts += 1;
                if ((attempts >= minAttempts && isFocused(target)) || attempts >= maxAttempts) return;

                schedule(step);
            };

            schedule(step);
        },
        cancel() {
            requestSeq += 1;
            clearFrame();
        },
    };
}

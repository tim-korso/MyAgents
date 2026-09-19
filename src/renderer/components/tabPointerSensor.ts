import type {
    Activators,
    PointerActivationConstraint,
    SensorInstance,
    SensorProps,
} from '@dnd-kit/core';
import type { PointerEvent as ReactPointerEvent } from 'react';

type Coordinates = {
    x: number;
    y: number;
};

export type TabPointerDragDecision = 'pending' | 'start' | 'cancel';

export interface TabPointerSensorOptions {
    minHorizontalDistance: number;
    maxVerticalDrift: number;
    verticalCancelDistance: number;
    horizontalDominanceRatio: number;
}

export const TAB_POINTER_SENSOR_OPTIONS = {
    minHorizontalDistance: 16,
    maxVerticalDrift: 6,
    verticalCancelDistance: 18,
    horizontalDominanceRatio: 1.4,
} satisfies TabPointerSensorOptions;

export function isPrimaryPointerButtonPressed(buttons: number): boolean {
    return (buttons & 1) === 1;
}

export function getTabPointerDragDecision(
    delta: Coordinates,
    options: TabPointerSensorOptions = TAB_POINTER_SENSOR_OPTIONS,
): TabPointerDragDecision {
    const dx = Math.abs(delta.x);
    const dy = Math.abs(delta.y);

    if (dy >= options.verticalCancelDistance && dy >= dx) {
        return 'cancel';
    }

    if (dx < options.minHorizontalDistance) {
        return 'pending';
    }

    if (dy <= options.maxVerticalDrift || dx >= dy * options.horizontalDominanceRatio) {
        return 'start';
    }

    return 'pending';
}

function eventCoordinates(event: PointerEvent): Coordinates {
    return { x: event.clientX, y: event.clientY };
}

function getOwnerDocument(target: EventTarget | null): Document {
    if (target instanceof Node) {
        return target.ownerDocument ?? document;
    }
    return document;
}

function preventDefault(event: Event): void {
    event.preventDefault();
}

function stopPropagation(event: Event): void {
    event.stopPropagation();
}

function pendingConstraint(options: TabPointerSensorOptions): PointerActivationConstraint {
    return { distance: options.minHorizontalDistance };
}

/**
 * Tab-specific pointer sensor for a horizontal titlebar tab strip.
 *
 * dnd-kit's generic PointerSensor treats any Euclidean movement past a small
 * distance as drag intent. On macOS trackpads, a tap often includes a few pixels
 * of pointer drift, and WebKit can occasionally deliver a move after the button
 * state has cleared. This sensor keeps the dnd-kit sortable pipeline, but makes
 * the titlebar's intent model explicit: horizontal reorder starts a drag;
 * ordinary tap drift does not.
 */
export class TabPointerSensor implements SensorInstance {
    static activators: Activators<TabPointerSensorOptions> = [
        {
            eventName: 'onPointerDown',
            handler: ({ nativeEvent: event }: ReactPointerEvent) => {
                return event.isPrimary && event.button === 0;
            },
        },
    ];

    autoScrollEnabled = true;

    private readonly props: SensorProps<TabPointerSensorOptions>;
    private readonly options: TabPointerSensorOptions;
    private readonly ownerDocument: Document;
    private readonly ownerWindow: Window;
    private readonly initialCoordinates: Coordinates;
    private activated = false;
    private detached = false;
    private removers: Array<() => void> = [];
    private clickCaptureRemover: (() => void) | null = null;

    constructor(props: SensorProps<TabPointerSensorOptions>) {
        const event = props.event as PointerEvent;
        this.props = props;
        this.options = props.options;
        this.ownerDocument = getOwnerDocument(event.target);
        this.ownerWindow = this.ownerDocument.defaultView ?? window;
        this.initialCoordinates = eventCoordinates(event);
        this.attach();
        this.handlePending({ x: 0, y: 0 });
    }

    private attach(): void {
        this.listen(this.ownerDocument, 'pointermove', this.handleMove, { passive: false });
        this.listen(this.ownerDocument, 'pointerup', this.handleEnd);
        this.listen(this.ownerDocument, 'pointercancel', this.handleCancel);
        this.listen(this.ownerDocument, 'keydown', this.handleKeydown);
        this.listen(this.ownerWindow, 'resize', this.handleCancel);
        this.listen(this.ownerWindow, 'visibilitychange', this.handleCancel);
        this.listen(this.ownerWindow, 'dragstart', preventDefault);
        this.listen(this.ownerWindow, 'contextmenu', preventDefault);
    }

    private listen(
        target: EventTarget,
        type: string,
        listener: EventListener,
        options?: AddEventListenerOptions,
    ): void {
        target.addEventListener(type, listener, options);
        this.removers.push(() => target.removeEventListener(type, listener, options));
    }

    private detach(): void {
        if (this.detached) return;
        this.detached = true;
        for (const remove of this.removers.splice(0)) remove();

        if (this.clickCaptureRemover) {
            const removeClickCapture = this.clickCaptureRemover;
            this.clickCaptureRemover = null;
            this.ownerWindow.setTimeout(removeClickCapture, 50);
        }
    }

    private handlePending(offset: Coordinates): void {
        this.props.onPending(
            this.props.active,
            pendingConstraint(this.options),
            this.initialCoordinates,
            offset,
        );
    }

    private handleStart(): void {
        if (this.activated) return;
        this.activated = true;
        this.ownerDocument.addEventListener('click', stopPropagation, { capture: true });
        this.clickCaptureRemover = () => {
            this.ownerDocument.removeEventListener('click', stopPropagation, { capture: true });
        };
        this.removeTextSelection();
        this.listen(this.ownerDocument, 'selectionchange', this.removeTextSelection);
        this.props.onStart(this.initialCoordinates);
    }

    private handleMove = (event: Event): void => {
        const pointerEvent = event as PointerEvent;
        if (!isPrimaryPointerButtonPressed(pointerEvent.buttons)) {
            this.handleEnd();
            return;
        }

        const coordinates = eventCoordinates(pointerEvent);
        const delta = {
            x: coordinates.x - this.initialCoordinates.x,
            y: coordinates.y - this.initialCoordinates.y,
        };

        if (!this.activated) {
            const decision = getTabPointerDragDecision(delta, this.options);
            if (decision === 'cancel') {
                this.handleCancel();
                return;
            }
            if (decision === 'start') {
                this.handleStart();
                return;
            }
            this.handlePending(delta);
            return;
        }

        if (pointerEvent.cancelable) {
            pointerEvent.preventDefault();
        }
        this.props.onMove(coordinates);
    };

    private handleEnd = (): void => {
        const wasActivated = this.activated;
        this.detach();
        if (!wasActivated) {
            this.props.onAbort(this.props.active);
        }
        this.props.onEnd();
    };

    private handleCancel = (): void => {
        const wasActivated = this.activated;
        this.detach();
        if (!wasActivated) {
            this.props.onAbort(this.props.active);
        }
        this.props.onCancel();
    };

    private handleKeydown = (event: Event): void => {
        if ((event as KeyboardEvent).code === 'Escape') {
            this.handleCancel();
        }
    };

    private removeTextSelection = (): void => {
        this.ownerDocument.getSelection()?.removeAllRanges();
    };
}

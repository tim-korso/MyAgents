import { describe, expect, it, vi } from 'vitest';
import type { SensorProps } from '@dnd-kit/core';

import { TabPointerSensor, TAB_POINTER_SENSOR_OPTIONS, type TabPointerSensorOptions } from './tabPointerSensor';

function pointerEvent(
    type: string,
    target: EventTarget,
    init: MouseEventInit & { isPrimary?: boolean } = {},
): PointerEvent {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: init.button ?? 0,
        buttons: init.buttons ?? 1,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
    }) as PointerEvent;
    Object.defineProperty(event, 'target', { configurable: true, value: target });
    Object.defineProperty(event, 'isPrimary', { configurable: true, value: init.isPrimary ?? true });
    return event;
}

function createSensor(event: PointerEvent) {
    const props = {
        active: 'tab-1',
        activeNode: { id: 'tab-1', node: { current: event.target as HTMLElement } },
        event,
        context: { current: {} },
        options: TAB_POINTER_SENSOR_OPTIONS,
        onAbort: vi.fn(),
        onPending: vi.fn(),
        onStart: vi.fn(),
        onCancel: vi.fn(),
        onMove: vi.fn(),
        onEnd: vi.fn(),
    };
    const sensor = new TabPointerSensor(props as unknown as SensorProps<TabPointerSensorOptions>);
    return { sensor, props };
}

describe('TabPointerSensor DOM lifecycle', () => {
    it('ends a stale pending interaction when the next move has no pressed button', () => {
        const target = document.createElement('span');
        document.body.appendChild(target);
        const { props } = createSensor(pointerEvent('pointerdown', target, { buttons: 1 }));

        document.dispatchEvent(pointerEvent('pointermove', target, {
            buttons: 0,
            clientX: 40,
            clientY: 0,
        }));

        expect(props.onStart).not.toHaveBeenCalled();
        expect(props.onAbort).toHaveBeenCalledWith('tab-1');
        expect(props.onEnd).toHaveBeenCalledTimes(1);
    });

    it('starts and ends an intentional horizontal drag while the button is pressed', () => {
        const target = document.createElement('span');
        document.body.appendChild(target);
        const { props } = createSensor(pointerEvent('pointerdown', target, { buttons: 1 }));

        document.dispatchEvent(pointerEvent('pointermove', target, {
            buttons: 1,
            clientX: TAB_POINTER_SENSOR_OPTIONS.minHorizontalDistance,
            clientY: 0,
        }));
        document.dispatchEvent(pointerEvent('pointermove', target, {
            buttons: 1,
            clientX: TAB_POINTER_SENSOR_OPTIONS.minHorizontalDistance + 8,
            clientY: 0,
        }));
        document.dispatchEvent(pointerEvent('pointerup', target, {
            buttons: 0,
            clientX: TAB_POINTER_SENSOR_OPTIONS.minHorizontalDistance + 8,
            clientY: 0,
        }));

        expect(props.onStart).toHaveBeenCalledWith({ x: 0, y: 0 });
        expect(props.onMove).toHaveBeenCalledWith({
            x: TAB_POINTER_SENSOR_OPTIONS.minHorizontalDistance + 8,
            y: 0,
        });
        expect(props.onAbort).not.toHaveBeenCalled();
        expect(props.onEnd).toHaveBeenCalledTimes(1);
    });
});

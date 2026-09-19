/**
 * Component-level regression for issue #310.
 *
 * The bug: typing into the "自定义" (custom) heartbeat-interval input either
 * lost the leading digit (when it was below the persisted min of 5) or
 * snapped the input back to empty + flipped a left-side preset chip (when
 * the leading digit matched a preset value). Repro: starting from the default
 * 30-minute preset, type "10" or "50" — neither should disturb preset chips
 * during typing.
 *
 * Helper unit tests live next to this file in heartbeatIntervalInput.test.ts.
 * These DOM tests cover the component wiring: that the local draft owns the
 * displayed text mid-typing and that preset clicks don't race with the blur
 * commit.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import HeartbeatConfigCard from './HeartbeatConfigCard';
import { DEFAULT_HEARTBEAT_CONFIG } from '../../../../shared/types/im';

async function expandMoreSettings() {
    await userEvent.click(screen.getByRole('button', { name: '更多设置' }));
}

describe('HeartbeatConfigCard — custom interval input (#310)', () => {
    it('keeps every keystroke of "10" visible while typing from the default preset state', async () => {
        const onChange = vi.fn();
        render(
            <HeartbeatConfigCard
                heartbeat={{ ...DEFAULT_HEARTBEAT_CONFIG, intervalMinutes: 30 }}
                onChange={onChange}
            />,
        );
        await expandMoreSettings();
        const input = screen.getByPlaceholderText('自定义') as HTMLInputElement;

        await userEvent.click(input);
        await userEvent.type(input, '1');
        expect(input.value).toBe('1'); // before the fix: snapped back to ''
        await userEvent.type(input, '0');
        expect(input.value).toBe('10');

        // No commit until blur.
        expect(onChange).not.toHaveBeenCalled();

        // Blur commits the final value.
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ intervalMinutes: 10 }),
        );
    });

    it('keeps "5" visible while typing toward "50", without lighting up the 5-minute preset chip', async () => {
        const onChange = vi.fn();
        render(
            <HeartbeatConfigCard
                heartbeat={{ ...DEFAULT_HEARTBEAT_CONFIG, intervalMinutes: 30 }}
                onChange={onChange}
            />,
        );
        await expandMoreSettings();
        const input = screen.getByPlaceholderText('自定义') as HTMLInputElement;

        await userEvent.click(input);
        await userEvent.type(input, '5');
        expect(input.value).toBe('5'); // before the fix: snapped back to ''
        // Preset chips are not touched mid-typing — no commit fired yet.
        expect(onChange).not.toHaveBeenCalled();

        await userEvent.type(input, '0');
        expect(input.value).toBe('50');
        fireEvent.blur(input);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ intervalMinutes: 50 }),
        );
    });

    it('does not drop the next custom edit after a preset was clicked while the input was unfocused', async () => {
        // #310 follow-up regression. An earlier fix suppressed the input's
        // blur-commit via a ref armed on every preset mousedown; clicking a
        // preset while the input was unfocused left that ref stale and silently
        // swallowed the *next* genuine edit. This asserts the behavioural
        // contract regardless of mechanism: a preset click must never break a
        // subsequent custom edit.
        const onChange = vi.fn();
        render(
            <HeartbeatConfigCard
                heartbeat={{ ...DEFAULT_HEARTBEAT_CONFIG, intervalMinutes: 30 }}
                onChange={onChange}
            />,
        );
        await expandMoreSettings();

        // 1. Click a preset chip with the custom input still unfocused.
        await userEvent.click(screen.getByRole('button', { name: '15 分钟' }));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ intervalMinutes: 15 }),
        );

        // 2. Now focus the custom input, type a value, and blur by clicking away.
        const input = screen.getByPlaceholderText('自定义') as HTMLInputElement;
        await userEvent.click(input);
        await userEvent.type(input, '45');
        expect(input.value).toBe('45');
        fireEvent.blur(input);

        // The typed value MUST be committed — before the fix it was dropped.
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ intervalMinutes: 45 }),
        );
    });

    it('commits the typed draft when a preset gets a non-left-button mousedown (right-click) rather than dropping it', async () => {
        // #310 follow-up: the previous flag-based suppression armed on EVERY
        // preset mousedown (any button). A right-click on a preset while editing
        // then blurred the input and the armed flag swallowed the draft commit —
        // the typed value vanished with nothing selected. Focus retention is
        // left-button only, so a right-click lets the input blur and commit
        // normally.
        const onChange = vi.fn();
        render(
            <HeartbeatConfigCard
                heartbeat={{ ...DEFAULT_HEARTBEAT_CONFIG, intervalMinutes: 30 }}
                onChange={onChange}
            />,
        );
        await expandMoreSettings();
        const input = screen.getByPlaceholderText('自定义') as HTMLInputElement;
        await userEvent.click(input);
        await userEvent.type(input, '45');

        // Right-button mousedown on a preset must NOT suppress the blur-commit.
        fireEvent.mouseDown(screen.getByRole('button', { name: '5 分钟' }), { button: 2 });
        fireEvent.blur(input);

        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ intervalMinutes: 45 }),
        );
    });

    it('clicking a preset while editing applies the preset and suppresses the draft commit', async () => {
        const onChange = vi.fn();
        render(
            <HeartbeatConfigCard
                heartbeat={{ ...DEFAULT_HEARTBEAT_CONFIG, intervalMinutes: 30 }}
                onChange={onChange}
            />,
        );
        await expandMoreSettings();
        const input = screen.getByPlaceholderText('自定义') as HTMLInputElement;
        await userEvent.click(input);
        await userEvent.type(input, '12');

        // mousedown on the preset fires before the input's blur — skip-blur ref
        // should prevent the intermediate "12" commit from racing with the
        // preset write.
        const presetBtn = screen.getByRole('button', { name: '5 分钟' });
        await userEvent.click(presetBtn);

        // Only one onChange call, and it carries the preset value.
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ intervalMinutes: 5 }),
        );
    });
});

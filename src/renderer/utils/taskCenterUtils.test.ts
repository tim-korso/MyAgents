import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import { formatTime } from './taskCenterUtils';

describe('formatTime', () => {
    beforeEach(async () => {
        await i18n.changeLanguage('zh-CN');
    });

    it('labels the previous local calendar day as yesterday even when less than 24 hours ago', () => {
        const now = new Date(2026, 5, 20, 9, 0);
        const yesterdayEvening = new Date(2026, 5, 19, 22, 0).toISOString();

        expect(formatTime(yesterdayEvening, now)).toBe('昨天');
    });

    it('uses local calendar-day distance instead of elapsed 24-hour buckets', () => {
        const now = new Date(2026, 5, 20, 0, 10);
        const twoCalendarDaysAgo = new Date(2026, 5, 18, 23, 50).toISOString();

        expect(formatTime(twoCalendarDaysAgo, now)).toBe('2天前');
    });

    it('keeps same-day times as clock labels', () => {
        const now = new Date(2026, 5, 20, 9, 0);
        const laterSameDay = new Date(2026, 5, 20, 22, 0).toISOString();

        expect(formatTime(laterSameDay, now)).toBe('22:00');
    });

    it('defaults to the active UI locale', async () => {
        await i18n.changeLanguage('en-US');
        const now = new Date(2026, 5, 20, 9, 0);
        const yesterdayEvening = new Date(2026, 5, 19, 22, 0).toISOString();

        expect(formatTime(yesterdayEvening, now)).toBe('Yesterday');
    });
});

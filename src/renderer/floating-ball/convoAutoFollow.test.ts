import { describe, expect, it } from 'vitest';

import { FOLLOW_THRESHOLD_PX, isNearBottom } from './convoAutoFollow';

describe('convoAutoFollow.isNearBottom', () => {
    it('贴底（含刚好在阈值内）→ 跟随', () => {
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
        expect(
            isNearBottom({
                scrollHeight: 1000,
                scrollTop: 600 - FOLLOW_THRESHOLD_PX + 1,
                clientHeight: 400,
            }),
        ).toBe(true);
    });

    it('上翻阅读（距底 ≥ 阈值）→ 不跟随（流式新内容不许拽回底部）', () => {
        expect(
            isNearBottom({ scrollHeight: 1000, scrollTop: 600 - FOLLOW_THRESHOLD_PX, clientHeight: 400 }),
        ).toBe(false);
        expect(isNearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 })).toBe(false);
    });

    it('内容不足一屏（不可滚）→ 恒跟随', () => {
        expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
    });
});

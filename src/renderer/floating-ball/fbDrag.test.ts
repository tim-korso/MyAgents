import { describe, expect, it } from 'vitest';

import { computeDragOrigin } from './fbDrag';

describe('computeDragOrigin', () => {
    it('窗口原点 = 光标全局点 − 抓取偏移', () => {
        // 抓在球中心（92×92 窗口的 ~46,46）：原点比光标左上各偏 46。
        expect(computeDragOrigin(500, 300, 46, 46)).toEqual({ x: 454, y: 254 });
    });

    it('与拖拽历史无关：同一光标位置永远同一落点（修掉增量振荡的不变量）', () => {
        // 旧实现的 bug 本质 = 落点依赖「上一帧读到的窗口位置」；新实现只依赖
        // 当前光标 + 恒定抓取偏移，故任意中途路径下，落点都只由终点决定。
        const a = computeDragOrigin(800, 600, 46, 46);
        const b = computeDragOrigin(800, 600, 46, 46);
        expect(a).toEqual(b);
        expect(a).toEqual({ x: 754, y: 554 });
    });

    it('跨屏负坐标（副屏在主屏左/上方）线性成立', () => {
        // 副屏在主屏左上 → 全局点为负；落点仍是纯减法，无分屏特判。
        expect(computeDragOrigin(-1200, -100, 46, 46)).toEqual({ x: -1246, y: -146 });
    });

    it('抓取偏移为 0（抓在窗口左上角）时落点 = 光标', () => {
        expect(computeDragOrigin(120, 80, 0, 0)).toEqual({ x: 120, y: 80 });
    });
});

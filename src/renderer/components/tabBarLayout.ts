export const TAB_ITEM_MIN_WIDTH_PX = 64;
export const TAB_ITEM_MAX_WIDTH_PX = 180;
export const TAB_BAR_GAP_PX = 2; // gap-0.5
export const TAB_BAR_BUTTON_WIDTH_PX = 28; // h-7 w-7

interface TabStripIdealWidthOptions {
    canAddTab: boolean;
}

export function getTabStripIdealWidth(
    tabCount: number,
    { canAddTab }: TabStripIdealWidthOptions,
): number {
    const safeTabCount = Math.max(0, tabCount);
    const tabGaps = Math.max(0, safeTabCount - 1);
    const visibleControlCount = canAddTab ? 1 : 0;
    const controlGaps = visibleControlCount > 0 && safeTabCount > 0 ? visibleControlCount : 0;

    return (
        safeTabCount * TAB_ITEM_MAX_WIDTH_PX +
        (tabGaps + controlGaps) * TAB_BAR_GAP_PX +
        visibleControlCount * TAB_BAR_BUTTON_WIDTH_PX
    );
}

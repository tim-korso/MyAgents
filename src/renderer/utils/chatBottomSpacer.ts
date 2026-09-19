const FALLBACK_OVERLAY_HEIGHT_PX = 176;
// Keep the streaming tail / final message comfortably above the floating
// composer. Two body lines is enough to read the boundary without creating a
// half-screen blank tail on short chats.
const EXTRA_CLEARANCE_PX = 40;
const MIN_SPACER_PX = 128;
const MAX_SPACER_PX = 420;

export function resolveChatBottomSpacerPx(measuredOverlayHeight?: number | null): number {
  const measured = typeof measuredOverlayHeight === 'number' && Number.isFinite(measuredOverlayHeight) && measuredOverlayHeight > 0
    ? measuredOverlayHeight
    : FALLBACK_OVERLAY_HEIGHT_PX;
  return Math.min(MAX_SPACER_PX, Math.max(MIN_SPACER_PX, Math.ceil(measured) + EXTRA_CLEARANCE_PX));
}

/**
 * Legacy pure helper retained for regression tests and historical notes.
 *
 * Runtime dragging no longer uses browser `screenX/Y` as native window
 * coordinates. On macOS multi-display setups that mixes WebView event
 * coordinates with AppKit/Tauri window coordinates and can jump between
 * displays. The live path is Rust-owned (`cmd_fb_drag_*`): it reads
 * `NSEvent.mouseLocation` and the current native window frame in one coordinate
 * authority.
 */
export function computeDragOrigin(
    pointerScreenX: number,
    pointerScreenY: number,
    grabX: number,
    grabY: number,
): { x: number; y: number } {
    return { x: pointerScreenX - grabX, y: pointerScreenY - grabY };
}

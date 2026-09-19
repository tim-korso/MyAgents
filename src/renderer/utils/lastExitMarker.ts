// Clean-exit marker reader (Issue #309).
//
// Rust records a `~/.myagents/last-exit.json` marker at the single
// `RunEvent::ExitRequested` chokepoint whenever the user DELIBERATELY quits
// (Cmd+Q / Dock / tray "Exit") — but NOT on an update-restart (suppressed by
// `RESTARTING_FOR_UPDATE`) and obviously not on a crash. See
// `src-tauri/src/app_dirs.rs::record_clean_exit`.
//
// On boot the renderer reads-and-clears this marker to decide the startup
// behaviour:
//   - marker present (`{ clean: true }`) → user quit on purpose → boot fresh,
//     no restore pill.
//   - marker absent (crash or update-restart) → offer to restore the previous
//     session via the title-bar pill.
//
// Why Rust writes it (not the renderer): tray "Exit" terminates the webview via
// `app.exit(0)` without a reliable `pagehide`, so only Rust's ExitRequested
// handler sees every deliberate-quit path. The renderer just consumes it.

import { join } from '@tauri-apps/api/path';
import { readTextFile, remove, exists } from '@tauri-apps/plugin-fs';
import { getConfigDir } from '@/config/services/configStore';
import { isBrowserDevMode } from '@/utils/browserMock';
import { parseCleanMarker } from './tabPersistence';

const LAST_EXIT_FILE = 'last-exit.json';

/** Read + DELETE the clean-exit marker. Returns true iff the last exit was a
 *  deliberate user quit. Consume-once (deleted on read) so a stale marker can't
 *  suppress a later legitimate restore. Best-effort: any failure degrades to
 *  `false` (offer restore) — the safe direction, since a dismissable pill beats
 *  silently losing recovery after a crash. */
export async function consumeCleanExitMarker(): Promise<boolean> {
    // Browser dev mode has no Rust to write the marker; treat every launch as a
    // clean quit so dev sessions aren't perpetually nagged by the restore pill.
    if (isBrowserDevMode()) return true;

    let path: string;
    try {
        path = await join(await getConfigDir(), LAST_EXIT_FILE);
    } catch {
        return false;
    }

    // Read AND delete together: we only trust a "clean" verdict for a marker we
    // actually CONSUMED. If the read or the delete throws, return false (offer
    // restore) — a surviving `{"clean":true}` we couldn't delete would otherwise
    // wrongly suppress the pill after a LATER crash. The safe direction is a
    // dismissable pill, never silently swallowing a crash's recovery.
    try {
        if (!(await exists(path))) return false;
        const raw = await readTextFile(path);
        await remove(path); // consume — must succeed for the marker to be honored
        return parseCleanMarker(raw);
    } catch {
        return false;
    }
}

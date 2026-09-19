import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
    convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`),
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: tauriMocks.convertFileSrc,
    invoke: tauriMocks.invoke,
}));

vi.mock('@/i18n', () => ({
    i18n: { t: (key: string) => key },
}));

import { installedPetRecordsToPacks } from './petPackLibrary';

describe('installed pet pack loading', () => {
    it('uses Tauri asset URLs for imported spritesheets', () => {
        const [pack] = installedPetRecordsToPacks([
            {
                id: 'pikachu',
                displayName: 'Pikachu',
                spritesheetFilePath: 'C:\\Users\\me\\.myagents\\pets\\pikachu\\spritesheet.webp',
                spritesheetPath: 'spritesheet.webp',
                source: 'myagents',
            },
        ]);

        expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith(
            'C:\\Users\\me\\.myagents\\pets\\pikachu\\spritesheet.webp',
        );
        expect(pack?.spritesheetUrl).toMatch(/^http:\/\/asset\.localhost\//);
    });

    it('keeps Windows WebView2 asset image URLs in the app CSP', () => {
        const tauriConfig = JSON.parse(
            readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
        ) as { app?: { security?: { csp?: string } } };

        const csp = tauriConfig.app?.security?.csp ?? '';
        const imgSrc = csp
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('img-src '));

        expect(imgSrc).toContain('http://asset.localhost');
    });
});

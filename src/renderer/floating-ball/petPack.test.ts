import { describe, expect, it } from 'vitest';

import minoPetManifest from '@/assets/floating-pets/mino/pet.json';
import minoPixelPetManifest from '@/assets/floating-pets/mino-pixel/pet.json';
import minoRunnerPetManifest from '@/assets/floating-pets/mino-runner/pet.json';

import { BUILTIN_PET_PACKS, DEFAULT_PET_PACK_ID, normalizeBuiltinPetPackId } from './defaultPetPack';
import { CODEX_PET_ANIMATION_NAMES, CODEX_PET_ATLAS, normalizePetAtlas, normalizePetManifest } from './petAtlas';

describe('CODEX_PET_ATLAS', () => {
    it('pins the current Codex-compatible 8x9 atlas contract', () => {
        expect(CODEX_PET_ATLAS).toMatchObject({
            columns: 8,
            rows: 9,
            cellWidth: 192,
            cellHeight: 208,
        });
        expect(Object.keys(CODEX_PET_ATLAS.animations)).toEqual([...CODEX_PET_ANIMATION_NAMES]);
    });

    it('keeps each animation row within the atlas', () => {
        for (const animation of CODEX_PET_ANIMATION_NAMES) {
            const spec = CODEX_PET_ATLAS.animations[animation];
            expect(spec.row).toBeGreaterThanOrEqual(0);
            expect(spec.row).toBeLessThan(CODEX_PET_ATLAS.rows);
            expect(spec.frames).toBeGreaterThan(0);
            expect(spec.frames).toBeLessThanOrEqual(CODEX_PET_ATLAS.columns);
            expect(spec.frameDurations).toHaveLength(spec.frames);
        }
    });

    it('normalizes its own row-zero atlas contract', () => {
        const atlas = normalizePetAtlas(CODEX_PET_ATLAS);
        expect(atlas).not.toBeNull();
        expect(atlas?.animations.idle.row).toBe(0);
    });
});

describe('normalizePetManifest', () => {
    it('accepts the minimal Codex-style pet.json shape and supplies the default atlas', () => {
        const manifest = normalizePetManifest({
            id: 'tater',
            displayName: 'Tater',
            spritesheetPath: 'spritesheet.webp',
        });
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            id: 'tater',
            displayName: 'Tater',
            spritesheetPath: 'spritesheet.webp',
        });
        expect(manifest?.atlas).toBe(CODEX_PET_ATLAS);
    });

    it('accepts all bundled manifests and supplies the default atlas', () => {
        const manifests = [minoPetManifest, minoPixelPetManifest, minoRunnerPetManifest]
            .map(normalizePetManifest);
        expect(manifests.map((manifest) => manifest?.id)).toEqual(['mino', 'mino-pixel', 'mino-runner']);
        for (const manifest of manifests) {
            expect(manifest?.spritesheetPath).toBe('spritesheet.webp');
            expect(manifest?.description).toBeTruthy();
            expect(manifest?.atlas).toBe(CODEX_PET_ATLAS);
        }
    });

    it('keeps the bundled pet registry ordered and compatible with the old default id', () => {
        const manifest = normalizePetManifest(minoPetManifest);
        expect(manifest?.id).toBe(DEFAULT_PET_PACK_ID);
        expect(BUILTIN_PET_PACKS.map((pack) => pack.id)).toEqual(['mino', 'mino-pixel', 'mino-runner']);
        expect(normalizeBuiltinPetPackId('mino-default')).toBe(DEFAULT_PET_PACK_ID);
    });

    it('rejects malformed manifests instead of guessing paths', () => {
        expect(normalizePetManifest({ id: 'no-sheet' })).toBeNull();
        expect(normalizePetManifest({ spritesheetPath: 'spritesheet.webp' })).toBeNull();
        expect(normalizePetManifest(null)).toBeNull();
    });

    it('rejects unsafe manifest ids and spritesheet paths before import support exists', () => {
        expect(normalizePetManifest({ id: '../tater', spritesheetPath: 'spritesheet.webp' })).toBeNull();
        expect(normalizePetManifest({ id: 'tater', spritesheetPath: '../spritesheet.webp' })).toBeNull();
        expect(normalizePetManifest({ id: 'tater', spritesheetPath: 'pets/spritesheet.webp' })).toBeNull();
        expect(normalizePetManifest({ id: 'tater', spritesheetPath: 'https://example.test/pet.webp' })).toBeNull();
        expect(normalizePetManifest({ id: 'tater', spritesheetPath: 'sprite.svg' })).toBeNull();
    });

    it('rejects explicit invalid atlas data instead of silently falling back', () => {
        expect(
            normalizePetManifest({
                id: 'tater',
                displayName: 'Tater',
                spritesheetPath: 'spritesheet.webp',
                atlas: {
                    columns: 8,
                    rows: 9,
                    cellWidth: 192,
                    cellHeight: 208,
                    animations: {},
                },
            }),
        ).toBeNull();
    });
});

describe('normalizePetAtlas', () => {
    it('rejects partial animation maps so missing rows cannot silently corrupt state mapping', () => {
        expect(
            normalizePetAtlas({
                columns: 8,
                rows: 9,
                cellWidth: 192,
                cellHeight: 208,
                animations: {
                    idle: { row: 0, frames: 1, frameDurations: [100] },
                },
            }),
        ).toBeNull();
    });

    it('preserves custom frame durations from a complete atlas', () => {
        const animations = Object.fromEntries(
            CODEX_PET_ANIMATION_NAMES.map((animation, index) => [
                animation,
                {
                    row: index,
                    frames: 1,
                    frameDurations: [animation === 'idle' ? 320 : 160],
                },
            ]),
        );
        const atlas = normalizePetAtlas({
            columns: 1,
            rows: 9,
            cellWidth: 64,
            cellHeight: 64,
            animations,
        });
        expect(atlas?.animations.idle.frameDurations).toEqual([320]);
        expect(atlas?.animations.review.frameDurations).toEqual([160]);
    });
});

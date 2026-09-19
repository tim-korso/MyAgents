import minoManifest from '@/assets/floating-pets/mino/pet.json';
import minoSpritesheetUrl from '@/assets/floating-pets/mino/spritesheet.webp';
import minoPixelManifest from '@/assets/floating-pets/mino-pixel/pet.json';
import minoPixelSpritesheetUrl from '@/assets/floating-pets/mino-pixel/spritesheet.webp';
import minoRunnerManifest from '@/assets/floating-pets/mino-runner/pet.json';
import minoRunnerSpritesheetUrl from '@/assets/floating-pets/mino-runner/spritesheet.webp';

import { normalizePetManifest, type PetPack } from './petAtlas';

export const DEFAULT_PET_PACK_ID = 'mino';
export const LEGACY_DEFAULT_PET_PACK_ID = 'mino-default';

function createBuiltinPetPack(manifestInput: unknown, spritesheetUrl: string): PetPack {
    const manifest = normalizePetManifest(manifestInput);
    if (!manifest) {
        throw new Error('[fb-pet] bundled pet manifest is invalid');
    }
    return {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        source: 'builtin',
        spritesheetUrl,
        atlas: manifest.atlas,
    };
}

export function normalizeBuiltinPetPackId(id: string | null | undefined): string | null {
    if (!id) return null;
    return id === LEGACY_DEFAULT_PET_PACK_ID ? DEFAULT_PET_PACK_ID : id;
}

export const MINO_DEFAULT_PET_PACK = createBuiltinPetPack(minoManifest, minoSpritesheetUrl);
export const MINO_PIXEL_PET_PACK = createBuiltinPetPack(minoPixelManifest, minoPixelSpritesheetUrl);
export const MINO_RUNNER_PET_PACK = createBuiltinPetPack(minoRunnerManifest, minoRunnerSpritesheetUrl);

export const BUILTIN_PET_PACKS = [
    MINO_DEFAULT_PET_PACK,
    MINO_PIXEL_PET_PACK,
    MINO_RUNNER_PET_PACK,
] as const;

export const BUILTIN_PET_PACK_IDS = BUILTIN_PET_PACKS.map((pack) => pack.id);

export const CODEX_PET_ANIMATION_NAMES = [
    'idle',
    'running-right',
    'running-left',
    'waving',
    'jumping',
    'failed',
    'waiting',
    'running',
    'review',
] as const;

export type CodexPetAnimationName = (typeof CODEX_PET_ANIMATION_NAMES)[number];

export interface PetFrameAnimation {
    row: number;
    frames: number;
    frameDurations: readonly number[];
}

export interface PetSpriteAtlas {
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    animations: Record<CodexPetAnimationName, PetFrameAnimation>;
}

export interface NormalizedPetManifest {
    schemaVersion: number;
    id: string;
    displayName: string;
    description?: string;
    author?: string;
    license?: string;
    spritesheetPath: string;
    atlas: PetSpriteAtlas;
}

export interface PetPack {
    id: string;
    displayName: string;
    description?: string;
    source?: 'builtin' | 'imported';
    spritesheetUrl: string;
    atlas: PetSpriteAtlas;
    spriteFilter?: string;
}

export const CODEX_PET_ATLAS = {
    columns: 8,
    rows: 9,
    cellWidth: 192,
    cellHeight: 208,
    animations: {
        idle: { row: 0, frames: 6, frameDurations: [280, 110, 110, 140, 140, 320] },
        'running-right': { row: 1, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
        'running-left': { row: 2, frames: 8, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
        waving: { row: 3, frames: 4, frameDurations: [140, 140, 140, 280] },
        jumping: { row: 4, frames: 5, frameDurations: [140, 140, 140, 140, 280] },
        failed: { row: 5, frames: 8, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
        waiting: { row: 6, frames: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
        running: { row: 7, frames: 6, frameDurations: [120, 120, 120, 120, 120, 220] },
        review: { row: 8, frames: 6, frameDurations: [150, 150, 150, 150, 150, 280] },
    },
} as const satisfies PetSpriteAtlas;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
    return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
    return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : undefined;
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function isSafePetId(value: string): boolean {
    return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}

function isSafeSpritesheetPath(value: string): boolean {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
    if (value.startsWith('/') || value.startsWith('\\')) return false;
    if (/^[A-Za-z]:[\\/]/.test(value)) return false;
    if (value.includes('/') || value.includes('\\')) return false;
    if (value === '.' || value === '..' || value.includes('..')) return false;
    return /^[A-Za-z0-9._-]+\.(?:webp|png)$/i.test(value);
}

function normalizeFrameAnimation(value: unknown, rows: number, columns: number): PetFrameAnimation | null {
    if (!isRecord(value)) return null;
    const row = readNonNegativeInteger(value.row);
    const frames = readPositiveInteger(value.frames);
    if (row === undefined || frames === undefined || row >= rows || frames > columns) return null;
    if (!Array.isArray(value.frameDurations)) return null;
    const frameDurations = value.frameDurations
        .map((duration) => readPositiveInteger(duration))
        .filter((duration): duration is number => duration !== undefined);
    if (frameDurations.length !== frames) return null;
    return { row, frames, frameDurations };
}

export function normalizePetAtlas(value: unknown): PetSpriteAtlas | null {
    if (!isRecord(value)) return null;
    const columns = readPositiveInteger(value.columns);
    const rows = readPositiveInteger(value.rows);
    const cellWidth = readPositiveInteger(value.cellWidth);
    const cellHeight = readPositiveInteger(value.cellHeight);
    if (columns === undefined || rows === undefined || cellWidth === undefined || cellHeight === undefined) {
        return null;
    }
    if (!isRecord(value.animations)) return null;

    const animations = {} as Record<CodexPetAnimationName, PetFrameAnimation>;
    for (const name of CODEX_PET_ANIMATION_NAMES) {
        const normalized = normalizeFrameAnimation(value.animations[name], rows, columns);
        if (!normalized) return null;
        animations[name] = normalized;
    }
    return { columns, rows, cellWidth, cellHeight, animations };
}

export function normalizePetManifest(value: unknown): NormalizedPetManifest | null {
    if (!isRecord(value)) return null;
    const id = readString(value.id);
    const spritesheetPath = readString(value.spritesheetPath);
    if (!id || !spritesheetPath) return null;
    if (!isSafePetId(id) || !isSafeSpritesheetPath(spritesheetPath)) return null;

    const schemaVersion = readPositiveInteger(value.schemaVersion) ?? 1;
    const displayName = readString(value.displayName) ?? id;
    const hasExplicitAtlas = hasOwnRecordKey(value, 'atlas');
    const atlas = hasExplicitAtlas ? normalizePetAtlas(value.atlas) : CODEX_PET_ATLAS;
    if (!atlas) return null;

    return {
        schemaVersion,
        id,
        displayName,
        description: readString(value.description),
        author: readString(value.author),
        license: readString(value.license),
        spritesheetPath,
        atlas,
    };
}

export function getPetAnimationSpec(atlas: PetSpriteAtlas, animation: CodexPetAnimationName): PetFrameAnimation {
    return atlas.animations[animation] ?? atlas.animations.idle;
}

export function getPetAnimationDuration(atlas: PetSpriteAtlas, animation: CodexPetAnimationName): number {
    return getPetAnimationSpec(atlas, animation).frameDurations.reduce((total, duration) => total + duration, 0);
}

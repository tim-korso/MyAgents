import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { i18n } from '@/i18n';
import { isTauriEnvironment } from '@/utils/browserMock';

import { BUILTIN_PET_PACKS, MINO_DEFAULT_PET_PACK, normalizeBuiltinPetPackId } from './defaultPetPack';
import { normalizePetManifest, type PetPack } from './petAtlas';

export interface InstalledPetRecord {
    id: string;
    displayName: string;
    description?: string;
    author?: string;
    license?: string;
    spritesheetFilePath: string;
    spritesheetPath: string;
    source: 'myagents' | 'codex';
    atlas?: unknown;
}

export interface PetImportSummary {
    imported: number;
    skipped: number;
    pets: InstalledPetRecord[];
}

export const BUILTIN_ORB_STYLE_ID = 'classic-orb';

export function getBuiltinPetPack(id: string | null | undefined): PetPack | null {
    const normalizedId = normalizeBuiltinPetPackId(id);
    return BUILTIN_PET_PACKS.find((pack) => pack.id === normalizedId) ?? null;
}

function normalizeInstalledPet(record: InstalledPetRecord): PetPack | null {
    const manifest = normalizePetManifest({
        id: record.id,
        displayName: record.displayName,
        description: record.description,
        author: record.author,
        license: record.license,
        spritesheetPath: record.spritesheetPath,
        ...(record.atlas ? { atlas: record.atlas } : {}),
    });
    if (!manifest) return null;
    return {
        id: manifest.id,
        displayName: manifest.displayName,
        description: manifest.description,
        source: 'imported',
        spritesheetUrl: convertFileSrc(record.spritesheetFilePath),
        atlas: manifest.atlas,
    };
}

export function installedPetRecordsToPacks(records: InstalledPetRecord[]): PetPack[] {
    return records
        .map(normalizeInstalledPet)
        .filter((pack): pack is PetPack => pack !== null)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listInstalledPetPacks(): Promise<PetPack[]> {
    if (!isTauriEnvironment()) return [];
    const records = await invoke<InstalledPetRecord[]>('cmd_fb_pet_list_installed');
    return installedPetRecordsToPacks(records);
}

export async function deleteInstalledPetPack(id: string): Promise<void> {
    if (!isTauriEnvironment()) {
        throw new Error(String(i18n.t('floatingBallPet.errors.unsupportedDelete', { ns: 'settings' })));
    }
    await invoke('cmd_fb_pet_delete_installed', { id });
}

export async function importPetFromPath(path: string): Promise<PetImportSummary> {
    if (!isTauriEnvironment()) {
        throw new Error(String(i18n.t('floatingBallPet.errors.unsupportedLocalImport', { ns: 'settings' })));
    }
    return invoke<PetImportSummary>('cmd_fb_pet_import_path', { path });
}

export async function importPetsFromCodex(): Promise<PetImportSummary> {
    if (!isTauriEnvironment()) {
        throw new Error(String(i18n.t('floatingBallPet.errors.unsupportedCodexImport', { ns: 'settings' })));
    }
    return invoke<PetImportSummary>('cmd_fb_pet_import_codex');
}

export async function importPetFromPetdex(url: string): Promise<PetImportSummary> {
    if (!isTauriEnvironment()) {
        throw new Error(String(i18n.t('floatingBallPet.errors.unsupportedPetdexImport', { ns: 'settings' })));
    }
    return invoke<PetImportSummary>('cmd_fb_pet_import_petdex', { url });
}

export async function resolveSelectedPetPack(petId: string | null | undefined): Promise<PetPack> {
    const builtin = getBuiltinPetPack(petId);
    if (builtin) return builtin;

    if (petId) {
        try {
            const imported = await listInstalledPetPacks();
            const found = imported.find((pack) => pack.id === petId);
            if (found) return found;
        } catch (err) {
            console.warn('[fb-pet] list installed pet packs failed:', err);
        }
    }

    return MINO_DEFAULT_PET_PACK;
}

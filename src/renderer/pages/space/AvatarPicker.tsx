import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SpaceAvatarPreset } from "@/api/spaceCloud";
import OverlayBackdrop from "@/components/OverlayBackdrop";
import { useCloseLayer } from "@/hooks/useCloseLayer";
import {
  useWorkspaceFileService,
  type WorkspaceFileService,
} from "@/hooks/useWorkspaceFileService";
import { SpaceAvatar } from "./SpaceAvatar";

export type AvatarPickerSelection =
  | { type: "upload"; avatarFilePath: string; previewUrl: string }
  | { type: "preset"; presetId: string; avatarUrl: string };

async function readAvatarPreview(
  fileService: Pick<WorkspaceFileService, "readPathsAsBase64">,
  path: string,
  fallbackError: string,
): Promise<string> {
  const result = await fileService.readPathsAsBase64({ paths: [path] });
  const file = result.files[0];
  if (!file || file.error) {
    throw new Error(file?.error || fallbackError);
  }
  return `data:${file.mimeType};base64,${file.data}`;
}

export default function AvatarPicker({
  kind,
  presets,
  selectedPresetId,
  currentAvatarUrl,
  loading,
  error,
  disabled = false,
  onLoad,
  onSelect,
  onClose,
}: {
  kind: "people" | "agents";
  presets: SpaceAvatarPreset[];
  selectedPresetId?: string | null;
  currentAvatarUrl?: string | null;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onLoad: () => void;
  onSelect: (selection: AvatarPickerSelection) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("app");
  const fileService = useWorkspaceFileService(null);
  const [pickingUpload, setPickingUpload] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const onLoadRef = useRef(onLoad);

  useCloseLayer(() => {
    if (disabled || pickingUpload) return false;
    onClose();
    return true;
  }, 240);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    if (!presets.length && !loading && !error) onLoadRef.current();
  }, [error, loading, presets.length]);

  const pickUpload = async () => {
    if (disabled || pickingUpload) return;
    setPickingUpload(true);
    setLocalError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("space.avatarPicker.uploadTitle"),
        filters: [
          {
            name: t("space.profile.imageFilter"),
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const previewUrl = await readAvatarPreview(
        fileService,
        selected,
        t("space.profile.avatarPreviewFailed"),
      );
      onSelect({ type: "upload", avatarFilePath: selected, previewUrl });
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPickingUpload(false);
    }
  };

  return (
    <OverlayBackdrop
      onClose={disabled || pickingUpload ? undefined : onClose}
      className="z-[240] items-center justify-center px-4 py-8"
    >
      <section className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--paper-elevated)] shadow-xl">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line-subtle)] px-5">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {kind === "people"
              ? t("space.avatarPicker.peopleTitle")
              : t("space.avatarPicker.agentsTitle")}
          </h2>
          <button
            type="button"
            disabled={disabled || pickingUpload}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-60"
            aria-label={t("space.detail.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-4 px-5 py-5">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
            <button
              type="button"
              disabled={disabled || pickingUpload}
              onClick={() => void pickUpload()}
              className="grid aspect-square place-items-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--paper)] text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-warm)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-warm)] disabled:cursor-wait disabled:opacity-60"
              aria-label={t("space.avatarPicker.upload")}
              title={t("space.avatarPicker.upload")}
            >
              {pickingUpload ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
            </button>
            {presets.map((preset) => {
              const selected =
                selectedPresetId === preset.id ||
                (!selectedPresetId && currentAvatarUrl === preset.url);
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onSelect({
                      type: "preset",
                      presetId: preset.id,
                      avatarUrl: preset.url,
                    })
                  }
                  className="relative grid aspect-square place-items-center rounded-lg border border-[var(--line-subtle)] bg-[var(--paper)] transition-colors hover:border-[var(--accent-warm)] hover:bg-[var(--paper-inset)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-warm)] disabled:cursor-wait disabled:opacity-60"
                  aria-label={t("space.avatarPicker.preset")}
                  title={preset.id}
                >
                  <SpaceAvatar
                    avatarUrl={preset.urls["128"] ?? preset.url}
                    size={44}
                  />
                  {selected && (
                    <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {loading && (
            <p className="text-sm text-[var(--ink-muted)]">
              {t("space.avatarPicker.loading")}
            </p>
          )}
          {(localError || error) && (
            <p className="text-sm font-medium text-[var(--error)]">
              {localError || error}
            </p>
          )}
        </div>
      </section>
    </OverlayBackdrop>
  );
}

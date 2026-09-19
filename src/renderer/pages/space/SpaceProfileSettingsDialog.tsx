import { useEffect, useMemo, useState } from "react";
import { Camera, Loader2, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { spaceErrorMessage, type SpaceSession } from "@/api/spaceCloud";
import OverlayBackdrop from "@/components/OverlayBackdrop";
import { useToast } from "@/components/Toast";
import { useCloseLayer } from "@/hooks/useCloseLayer";
import AvatarPicker, { type AvatarPickerSelection } from "./AvatarPicker";
import type { SpaceActions, SpaceAvatarPresetsState } from "./spaceStore";
import { SpaceAvatar, spaceDisplayName } from "./SpaceAvatar";

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export default function SpaceProfileSettingsDialog({
  session,
  actions,
  avatarPresets,
  onClose,
}: {
  session: SpaceSession;
  actions: SpaceActions;
  avatarPresets: SpaceAvatarPresetsState;
  onClose: () => void;
}) {
  const { t } = useTranslation("app");
  const toast = useToast();
  const initialName = useMemo(
    () => spaceDisplayName(session.user),
    [session.user],
  );
  const [name, setName] = useState(initialName);
  const [avatarFilePath, setAvatarFilePath] = useState<string | null>(null);
  const [avatarPresetId, setAvatarPresetId] = useState<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useCloseLayer(() => {
    if (saving || avatarPickerOpen) return false;
    onClose();
    return true;
  }, 220);

  useEffect(() => {
    setName(initialName);
    setAvatarFilePath(null);
    setAvatarPresetId(null);
    setAvatarPreviewUrl(null);
    setError(null);
  }, [initialName, session.user.avatarPresetId, session.user.avatarUrl]);

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== initialName;
  const chosenPresetChanged =
    avatarPresetId !== null &&
    avatarPresetId !== (session.user.avatarPresetId ?? null);
  const dirty = nameChanged || Boolean(avatarFilePath) || chosenPresetChanged;
  const canSave =
    dirty && trimmedName.length > 0 && trimmedName.length <= 40 && !saving;
  const previewUrl = avatarPreviewUrl ?? session.user.avatarUrl ?? null;

  const openAvatarPicker = () => {
    if (saving) return;
    setAvatarPickerOpen(true);
    setError(null);
  };

  const selectAvatar = (selection: AvatarPickerSelection) => {
    if (selection.type === "upload") {
      setAvatarFilePath(selection.avatarFilePath);
      setAvatarPresetId(null);
      setAvatarPreviewUrl(selection.previewUrl);
    } else {
      setAvatarFilePath(null);
      setAvatarPresetId(selection.presetId);
      setAvatarPreviewUrl(selection.avatarUrl);
    }
    setAvatarPickerOpen(false);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await actions.updateProfile({
        name: trimmedName,
        avatarFilePath,
        avatarPresetId,
        nameChanged,
      });
      toast.success(t("space.profile.profileUpdated"));
      onClose();
    } catch (cause) {
      setError(spaceErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverlayBackdrop
      onClose={saving ? undefined : onClose}
      className="z-[220] items-center justify-center px-4 py-8"
    >
      <section className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-xl">
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--line-subtle)] px-5">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {t("space.profile.title")}
          </h2>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-60"
            aria-label={t("space.detail.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-5 px-5 py-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={saving}
              onClick={openAvatarPicker}
              className="group relative grid h-16 w-16 shrink-0 place-items-center rounded-full text-[var(--ink-muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-warm)] disabled:cursor-wait disabled:opacity-70"
              aria-label={t("space.profile.changeAvatar")}
              title={t("space.profile.changeAvatar")}
            >
              <SpaceAvatar
                name={trimmedName || initialName}
                email={session.user.email}
                avatarUrl={previewUrl}
                size={64}
              />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-[var(--ink)]/45 text-[var(--paper)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="h-4 w-4" />
              </span>
            </button>
            <div className="min-w-0">
              <button
                type="button"
                disabled={saving}
                onClick={openAvatarPicker}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-3 text-sm font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[var(--paper-inset)] disabled:cursor-wait disabled:opacity-70"
              >
                <Camera className="h-4 w-4" />
                {t("space.profile.changeAvatar")}
              </button>
              <p className="mt-2 truncate text-xs text-[var(--ink-muted)]">
                {avatarFilePath
                  ? basename(avatarFilePath)
                  : avatarPresetId
                    ? t("space.avatarPicker.preset")
                    : t("space.profile.avatarHint")}
              </p>
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">
              {t("space.profile.nickname")}
            </span>
            <input
              value={name}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              className="h-10 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] focus:border-[var(--accent-warm)] disabled:cursor-wait disabled:opacity-70"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">
              {t("space.profile.email")}
            </span>
            <input
              value={session.user.email}
              readOnly
              disabled
              className="h-10 rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-inset)] px-3 text-sm text-[var(--ink-muted)]"
            />
          </label>

          {trimmedName.length === 0 && (
            <p className="text-xs font-medium text-[var(--error)]">
              {t("space.profile.nicknameRequired")}
            </p>
          )}
          {error && (
            <p className="text-xs font-medium text-[var(--error)]">{error}</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--line-subtle)] px-5 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] px-3 text-sm font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-[var(--paper-inset)] disabled:cursor-wait disabled:opacity-70"
          >
            {t("space.common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--button-primary-bg)] px-3 text-sm font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? t("space.profile.saving") : t("space.profile.save")}
          </button>
        </footer>
      </section>
      {avatarPickerOpen && (
        <AvatarPicker
          kind="people"
          presets={avatarPresets.people}
          selectedPresetId={
            avatarPresetId ?? session.user.avatarPresetId ?? null
          }
          currentAvatarUrl={previewUrl}
          loading={avatarPresets.isLoading}
          error={avatarPresets.error}
          disabled={saving}
          onLoad={() =>
            void actions.loadAvatarPresets({ maxAgeMs: 5 * 60_000 })
          }
          onSelect={selectAvatar}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </OverlayBackdrop>
  );
}

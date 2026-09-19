import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpaceSession } from "@/api/spaceCloud";
import { i18n } from "@/i18n";
import type { SpaceActions } from "./spaceStore";
import SpaceProfileSettingsDialog from "./SpaceProfileSettingsDialog";

vi.mock("@/components/Toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCloseLayer", () => ({
  useCloseLayer: vi.fn(),
}));

const session: SpaceSession = {
  baseUrl: "https://space.myagents.test",
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "Old Name",
    avatarUrl: "https://r2-public.myagents.test/old.png",
  },
  space: {
    id: "space-1",
    slug: "official",
    name: "Official Space",
    joinPolicy: "open",
  },
  membership: { id: "membership-1", role: "member" },
  updatedAt: "2026-07-05T00:00:00.000Z",
};

describe("SpaceProfileSettingsDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  it("keeps email read-only and saves nickname changes through SpaceActions", async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <SpaceProfileSettingsDialog
        session={session}
        actions={
          {
            updateProfile,
            loadAvatarPresets: vi.fn(),
          } as unknown as SpaceActions
        }
        avatarPresets={{
          people: [],
          agents: [],
          lastFetchedAt: 0,
          isLoading: false,
          error: null,
        }}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Account settings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByDisplayValue("user@example.com")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Nickname"));
    await user.type(screen.getByLabelText("Nickname"), "New Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        name: "New Name",
        avatarFilePath: null,
        avatarPresetId: null,
        nameChanged: true,
      });
    });
    expect(onClose).toHaveBeenCalled();
  });
});

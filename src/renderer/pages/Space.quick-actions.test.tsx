import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { SpaceQuickActionDialog } from "@/pages/Space";

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ error: vi.fn() }),
}));

vi.mock("@/hooks/useCloseLayer", () => ({
  useCloseLayer: vi.fn(),
}));

describe("SpaceQuickActionDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  it("creates a Space only from an explicit button click, never Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SpaceQuickActionDialog
        mode="create"
        busy={false}
        error={null}
        onClose={vi.fn()}
        onClearError={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const nameInput = screen.getByLabelText("Space name");
    const slugInput = screen.getByLabelText("Space slug");
    await user.type(nameInput, "MA");
    expect(slugInput).toHaveValue("ma");

    await user.type(nameInput, "{Enter}");
    await user.type(slugInput, "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create Space" }));
    expect(onSubmit).toHaveBeenCalledWith({
      mode: "create",
      name: "MA",
      slug: "ma",
      avatarFilePath: null,
    });
  });
});

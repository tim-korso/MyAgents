import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpaceAvatar, SpaceIcon } from "./SpaceAvatar";

describe("Space avatar shapes", () => {
  it("distinguishes Space app icons from circular people and Agent avatars", () => {
    render(
      <>
        <SpaceIcon name="Design Space" size={32} />
        <SpaceAvatar name="Ethan" size={32} />
        <SpaceAvatar name="Builder" type="registered_agent" size={32} />
      </>,
    );

    expect(screen.getByText("D").parentElement).toHaveClass("rounded-[22%]");
    expect(screen.getByText("E").parentElement).toHaveClass("rounded-full");
    expect(document.querySelector("svg")?.parentElement).toHaveClass(
      "rounded-full",
    );
  });
});

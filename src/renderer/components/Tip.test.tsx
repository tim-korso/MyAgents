import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import Tip from "./Tip";

describe("Tip", () => {
  it("dismisses on click even when the action stops bubbling, without moving focus", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<Tip label="预览"><button onClick={(event) => { event.stopPropagation(); action(); }}>trigger</button></Tip>);
    const trigger = screen.getByRole("button", { name: "trigger" });
    await user.hover(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.click(trigger);
    expect(action).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it.each(["{Enter}", " "])("dismisses keyboard activation %s and reopens on fresh focus", async (key) => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<><Tip label="预览"><button onClick={action}>trigger</button></Tip><button>next</button></>);
    await user.tab();
    const trigger = screen.getByRole("button", { name: "trigger" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard(key);
    expect(action).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("does not leave a portal behind when activation hides a still-mounted surface", async () => {
    const user = userEvent.setup();
    function Surface() {
      const [hidden, setHidden] = useState(false);
      return <><div hidden={hidden}><Tip label="关闭"><button onClick={() => setHidden(true)}>close</button></Tip></div><button onClick={() => setHidden(false)}>restore</button></>;
    }
    render(<Surface />);
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "restore" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not resurrect the hint when the same trigger closes its popover", async () => {
    const user = userEvent.setup();
    function Menu() {
      const [open, setOpen] = useState(false);
      return <Tip label="更多" disabled={open}><button aria-expanded={open} onClick={() => setOpen(value => !value)}>menu</button></Tip>;
    }
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "menu" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("portals an immediate theme-owned tooltip above clipped surfaces", () => {
    render(
      <Tip label="任务" position="right">
        <button type="button">trigger</button>
      </Tip>,
    );

    const trigger = screen.getByRole("button", { name: "trigger" });
    expect(screen.queryByRole("tooltip", { name: "任务" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(trigger.parentElement!);

    const tooltip = screen.getByRole("tooltip", { name: "任务" });
    expect(tooltip).toHaveClass(
      "bg-[var(--button-dark-bg)]/90",
      "text-[var(--button-dark-text)]",
    );
    expect(tooltip).not.toHaveClass("delay-500", "transition-opacity");
    expect(trigger.parentElement).not.toContainElement(tooltip);
    expect(tooltip.parentElement).toHaveStyle({ zIndex: "280" });
  });

  it("suppresses its label while the trigger owns an open popover", () => {
    render(
      <Tip label="更多" disabled>
        <button type="button">trigger</button>
      </Tip>,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "trigger" }).parentElement!);

    expect(
      screen.queryByRole("tooltip", { name: "更多" }),
    ).not.toBeInTheDocument();
  });

  it("stays visible while either hover or focus remains active", () => {
    render(
      <Tip label="组合状态">
        <button type="button">trigger</button>
      </Tip>,
    );

    const trigger = screen.getByRole("button", { name: "trigger" });
    const wrapper = trigger.parentElement!;

    fireEvent.focus(trigger);
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    expect(screen.getByRole("tooltip", { name: "组合状态" })).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip", { name: "组合状态" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(wrapper);
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.getByRole("tooltip", { name: "组合状态" })).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip", { name: "组合状态" })).not.toBeInTheDocument();
  });
});

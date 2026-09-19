import { describe, expect, it } from "vitest";

import type { DirectoryTreeNode } from "../../../shared/dir-types";
import type { VisibleTreeRow } from "./treeTypes";

import { findTypeAheadTarget, resolveTreeKeyAction } from "./treeKeyboard";

function row(path: string, type: "file" | "dir"): VisibleTreeRow {
  const data: DirectoryTreeNode = {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type,
  };
  return {
    data,
    depth: path.split("/").length - 1,
    isDir: type === "dir",
    isLoading: false,
    isOpen: false,
    isSelected: false,
    parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null,
    path,
  };
}

// docs(dir, open) > docs/a.md, docs/b.md, readme.md
const ROWS = [row("docs", "dir"), row("docs/a.md", "file"), row("docs/b.md", "file"), row("readme.md", "file")];
const openDocs = (p: string) => p === "docs";

function key(k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) {
  return {
    key: k,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  };
}

describe("resolveTreeKeyAction", () => {
  it("ArrowDown/Up move focus, clamped at the edges", () => {
    expect(
      resolveTreeKeyAction(key("ArrowDown"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs/a.md", extendSelection: false });
    expect(
      resolveTreeKeyAction(key("ArrowUp"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs", extendSelection: false });
    expect(
      resolveTreeKeyAction(key("ArrowDown"), { rows: ROWS, focusedPath: "readme.md", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "readme.md", extendSelection: false });
  });

  it("ArrowDown with no focus starts at the first row; Shift extends selection", () => {
    expect(
      resolveTreeKeyAction(key("ArrowDown"), { rows: ROWS, focusedPath: null, isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs", extendSelection: false });
    expect(
      resolveTreeKeyAction(key("ArrowDown", { shift: true }), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs/a.md", extendSelection: true });
  });

  it("ArrowLeft collapses an open dir, otherwise focuses the parent", () => {
    expect(
      resolveTreeKeyAction(key("ArrowLeft"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "collapse", path: "docs" });
    expect(
      resolveTreeKeyAction(key("ArrowLeft"), { rows: ROWS, focusedPath: "docs/a.md", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs", extendSelection: false });
    expect(
      resolveTreeKeyAction(key("ArrowLeft"), { rows: ROWS, focusedPath: "readme.md", isOpen: openDocs }),
    ).toBeNull();
  });

  it("ArrowRight expands a closed dir, focuses first child of an open dir, no-ops on files", () => {
    expect(
      resolveTreeKeyAction(key("ArrowRight"), { rows: ROWS, focusedPath: "docs", isOpen: () => false }),
    ).toEqual({ type: "expand", path: "docs" });
    expect(
      resolveTreeKeyAction(key("ArrowRight"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "focus", path: "docs/a.md", extendSelection: false });
    expect(
      resolveTreeKeyAction(key("ArrowRight"), { rows: ROWS, focusedPath: "readme.md", isOpen: openDocs }),
    ).toBeNull();
  });

  it("Enter activates, F2 renames, Delete/Cmd+Backspace delete", () => {
    expect(
      resolveTreeKeyAction(key("Enter"), { rows: ROWS, focusedPath: "docs/a.md", isOpen: openDocs }),
    ).toEqual({ type: "activate", path: "docs/a.md" });
    expect(
      resolveTreeKeyAction(key("F2"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "rename", path: "docs" });
    expect(
      resolveTreeKeyAction(key("Delete"), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "delete" });
    expect(
      resolveTreeKeyAction(key("Backspace", { meta: true }), { rows: ROWS, focusedPath: "docs", isOpen: openDocs }),
    ).toEqual({ type: "delete" });
  });

  it("Cmd shortcuts: A/C/X/V/Z; Cmd+Shift+Z is NOT undo (no redo support)", () => {
    const ctx = { rows: ROWS, focusedPath: "docs", isOpen: openDocs };
    expect(resolveTreeKeyAction(key("a", { meta: true }), ctx)).toEqual({ type: "select-all" });
    expect(resolveTreeKeyAction(key("c", { meta: true }), ctx)).toEqual({ type: "copy" });
    expect(resolveTreeKeyAction(key("x", { meta: true }), ctx)).toEqual({ type: "cut" });
    expect(resolveTreeKeyAction(key("v", { meta: true }), ctx)).toEqual({ type: "paste" });
    expect(resolveTreeKeyAction(key("z", { meta: true }), ctx)).toEqual({ type: "undo" });
    expect(resolveTreeKeyAction(key("z", { meta: true, shift: true }), ctx)).toBeNull();
  });

  it("printable characters become type-ahead", () => {
    expect(
      resolveTreeKeyAction(key("r"), { rows: ROWS, focusedPath: null, isOpen: openDocs }),
    ).toEqual({ type: "type-ahead", char: "r" });
  });
});

describe("findTypeAheadTarget", () => {
  it("finds the next match after focus, wrapping and case-insensitive", () => {
    expect(findTypeAheadTarget(ROWS, "docs", "re")).toBe("readme.md");
    expect(findTypeAheadTarget(ROWS, "readme.md", "DOCS")).toBe("docs");
    // Wraps past the end back to an earlier row.
    expect(findTypeAheadTarget(ROWS, "docs/b.md", "a")).toBe("docs/a.md");
    expect(findTypeAheadTarget(ROWS, null, "zzz")).toBeNull();
  });
});

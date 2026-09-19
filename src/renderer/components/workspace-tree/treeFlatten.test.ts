import { describe, expect, it, vi } from "vitest";

import type { StickyAncestor } from "./treeTypes";

import type { DirectoryTreeNode } from "../../../shared/dir-types";
import type {
  TreeListItem,
  VisibleTreeRow,
  WorkspaceTreeNodeMeta,
} from "./treeTypes";

import {
  buildStickyAncestors,
  buildTreeListItems,
  computeStickyPushPx,
  MAX_STICKY_ANCESTOR_DEPTH,
  resolveStickyAncestors,
} from "./treeFlatten";

const ROW = 26;

/**
 * Build an `ancestorsAt(firstVisibleIndex)` stub that mirrors the real
 * `getStickyAncestors`: index 0 (or below) has no ancestors, otherwise the
 * ancestor count for that index comes from `depthByIndex`, capped at maxDepth.
 */
function ancestorsAtFrom(
  depthByIndex: Record<number, number>,
  maxDepth = MAX_STICKY_ANCESTOR_DEPTH,
): (firstVisibleIndex: number) => StickyAncestor[] {
  return (firstVisibleIndex: number) => {
    if (firstVisibleIndex <= 0) return [];
    const count = Math.min(depthByIndex[firstVisibleIndex] ?? 0, maxDepth);
    return Array.from({ length: count }, (_, i) => ({
      depth: i,
      id: `anc-${firstVisibleIndex}-${i}`,
      name: `anc-${firstVisibleIndex}-${i}`,
      path: `/anc/${firstVisibleIndex}/${i}`,
    }));
  };
}

// OVERLAY MODEL (regression for the "sticky jump" bug): the breadcrumb bar
// floats OVER the scroll content and occupies no scroll space, so data rows
// never shift when the breadcrumb depth changes. The row at the sticky bar's
// bottom edge is therefore `floor(scrollTop / rowHeight) + count` — count
// enters POSITIVELY (the bar covers `count` rows below the viewport top).
// The pre-fix header-spacer model used `topUnits - count`, which required a
// scroll-content spacer whose height change made the whole list jump by
// ±rowHeight at every depth boundary while scrolling.
describe("resolveStickyAncestors", () => {
  it("returns [] at the very top (scrollTop <= 0)", () => {
    const spy = vi.fn(() => [] as StickyAncestor[]);
    expect(resolveStickyAncestors(0, ROW, MAX_STICKY_ANCESTOR_DEPTH, spy)).toEqual([]);
    expect(resolveStickyAncestors(-5, ROW, MAX_STICKY_ANCESTOR_DEPTH, spy)).toEqual([]);
    // No need to probe ancestors when there is no scroll.
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns [] for a non-positive rowHeight (guard against div-by-zero)", () => {
    const spy = vi.fn(() => [] as StickyAncestor[]);
    expect(resolveStickyAncestors(100, 0, MAX_STICKY_ANCESTOR_DEPTH, spy)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns [] when the boundary row is a top-level entry (no ancestors)", () => {
    // scrollTop two rows down; row 2 has depth 0 → empty stack is consistent.
    const ancestorsAt = ancestorsAtFrom({ 2: 0 });
    expect(
      resolveStickyAncestors(2 * ROW, ROW, MAX_STICKY_ANCESTOR_DEPTH, ancestorsAt),
    ).toEqual([]);
  });

  it("returns [] just past the top while the index is still 0", () => {
    // scrollTop within the first row → topUnits = 0, count starts 0 →
    // firstVisibleIndex 0 → guard yields [] → consistent.
    const ancestorsAt = ancestorsAtFrom({ 1: 2 });
    expect(
      resolveStickyAncestors(10, ROW, MAX_STICKY_ANCESTOR_DEPTH, ancestorsAt),
    ).toEqual([]);
  });

  it("probes the row BELOW the bar (topUnits + count), never an already-scrolled-out row", () => {
    // topUnits = 4. With a 2-deep stack the bar covers rows 4..5, so the
    // consistent boundary row is 6 — NOT row 2 (the header-spacer model's
    // `topUnits - count`).
    const ancestorsAt = vi.fn(ancestorsAtFrom({ 4: 2, 6: 2 }));
    const result = resolveStickyAncestors(
      4 * ROW,
      ROW,
      MAX_STICKY_ANCESTOR_DEPTH,
      ancestorsAt,
    );
    expect(result).toHaveLength(2);
    const probedIndexes = ancestorsAt.mock.calls.map((c) => c[0]);
    expect(probedIndexes).toContain(6);
    expect(probedIndexes.every((i) => i >= 4)).toBe(true);
  });

  it("resolves a multi-step fixed point (depth grows as the bar covers more rows)", () => {
    // topUnits = 5. count 0→idx5(=1)→count1→idx6(=3)→count3→idx8(=3) → settle 3.
    const ancestorsAt = ancestorsAtFrom({ 5: 1, 6: 3, 8: 3 });
    const result = resolveStickyAncestors(
      5 * ROW,
      ROW,
      MAX_STICKY_ANCESTOR_DEPTH,
      ancestorsAt,
    );
    expect(result).toHaveLength(3);
  });

  it("caps the stack at maxDepth", () => {
    const ancestorsAt = ancestorsAtFrom({ 10: 9, 13: 9 }, 3);
    const result = resolveStickyAncestors(10 * ROW, ROW, 3, ancestorsAt);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic at a depth boundary with no exact fixed point (no oscillation)", () => {
    // f alternates between adjacent candidate rows, so there is no exact
    // fixed point. The result must still be identical across calls — that
    // determinism is what kills the cross-render flicker.
    const ancestorsAt = ancestorsAtFrom({ 3: 1, 4: 0 });
    const a = resolveStickyAncestors(3 * ROW, ROW, MAX_STICKY_ANCESTOR_DEPTH, ancestorsAt);
    const b = resolveStickyAncestors(3 * ROW, ROW, MAX_STICKY_ANCESTOR_DEPTH, ancestorsAt);
    const c = resolveStickyAncestors(3 * ROW, ROW, MAX_STICKY_ANCESTOR_DEPTH, ancestorsAt);
    expect(a.map((x) => x.path)).toEqual(b.map((x) => x.path));
    expect(b.map((x) => x.path)).toEqual(c.map((x) => x.path));
  });

  it("never calls the walker more than maxDepth + 1 times (bounded work)", () => {
    const base = ancestorsAtFrom({ 3: 1, 4: 0 });
    const spy = vi.fn(base);
    resolveStickyAncestors(3 * ROW, ROW, MAX_STICKY_ANCESTOR_DEPTH, spy);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_STICKY_ANCESTOR_DEPTH + 1);
  });
});

function makeDirRow(path: string, opts?: Partial<VisibleTreeRow>): VisibleTreeRow {
  const data: DirectoryTreeNode = {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "dir",
    children: [],
    ...((opts?.data ?? {}) as Partial<DirectoryTreeNode>),
  };
  return {
    data,
    depth: path.split("/").length - 1,
    isDir: true,
    isLoading: false,
    isOpen: false,
    isSelected: false,
    parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null,
    path,
    ...opts,
    ...(opts?.data ? { data: { ...data, ...opts.data } } : {}),
  };
}

function makeFileRow(path: string): VisibleTreeRow {
  const data: DirectoryTreeNode = {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
  };
  return {
    data,
    depth: path.split("/").length - 1,
    isDir: false,
    isLoading: false,
    isOpen: false,
    isSelected: false,
    parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null,
    path,
  };
}

function asItems(rows: VisibleTreeRow[]): TreeListItem[] {
  return rows.map((row) => ({ kind: "node", key: row.path, row }));
}

describe("buildStickyAncestors probe clamping", () => {
  function makeFixture(): {
    items: TreeListItem[];
    meta: Map<string, WorkspaceTreeNodeMeta>;
  } {
    const dir = makeDirRow("a", { isOpen: true });
    const rows = [dir, makeFileRow("a/x.md"), makeFileRow("a/y.md")];
    const meta = new Map<string, WorkspaceTreeNodeMeta>([
      ["a", { data: dir.data, depth: 0, parentPath: null }],
    ]);
    return { items: asItems(rows), meta };
  }

  // Regression: the overlay probe (`topUnits + count`) can overshoot the row
  // list near the scroll bottom of a SHORT viewport. Bailing to [] there made
  // the fixed point oscillate between [] and an n-deep stack across row
  // boundaries (per-row breadcrumb flicker at the bottom). Overshoot must
  // clamp to the LAST row's ancestors instead.
  it("clamps an overshooting index to the last row's ancestors", () => {
    const { items, meta } = makeFixture();
    const result = buildStickyAncestors(items, meta, 10, ROW, MAX_STICKY_ANCESTOR_DEPTH);
    expect(result.map((a) => a.path)).toEqual(["a"]);
  });

  it("still returns [] for an empty list", () => {
    expect(
      buildStickyAncestors([], new Map(), 5, ROW, MAX_STICKY_ANCESTOR_DEPTH),
    ).toEqual([]);
  });
});

describe("buildTreeListItems", () => {
  const siblingNames = new Set<string>();

  it("passes rows through unchanged with no editing state", () => {
    const child = makeFileRow("a/x.md");
    const dir = makeDirRow("a", { isOpen: true });
    dir.data.children = [child.data];
    const items = buildTreeListItems([dir, child], null);
    expect(items.map((i) => i.kind)).toEqual(["node", "node"]);
  });

  it("replaces the renamed node with the edit row IN PLACE", () => {
    const rows = [makeFileRow("a.md"), makeFileRow("b.md")];
    const items = buildTreeListItems(rows, {
      mode: "rename",
      path: "a.md",
      initialName: "a.md",
      isDir: false,
      siblingNames,
    });
    expect(items[0].kind).toBe("edit");
    expect(items[1]).toMatchObject({ kind: "node", key: "b.md" });
  });

  it("inserts a create-edit row at the top for the root, and after the parent dir otherwise", () => {
    const dir = makeDirRow("docs", { isOpen: true });
    const rows = [dir, makeFileRow("docs/x.md")];
    const atRoot = buildTreeListItems(rows, {
      mode: "create-file",
      parentDir: "",
      siblingNames,
    });
    expect(atRoot[0].kind).toBe("edit");

    const inDir = buildTreeListItems(rows, {
      mode: "create-folder",
      parentDir: "docs",
      siblingNames,
    });
    expect(inDir.map((i) => i.kind)).toEqual(["node", "edit", "node"]);
    expect(inDir[1]).toMatchObject({ depth: 1 });
  });

  it("adds an empty-hint under open+loaded+empty dirs, suppressed while creating there", () => {
    const empty = makeDirRow("empty", { isOpen: true });
    const plain = buildTreeListItems([empty], null);
    expect(plain.map((i) => i.kind)).toEqual(["node", "empty-hint"]);
    expect(plain[1]).toMatchObject({ parentDir: "empty", depth: 1 });

    const whileCreating = buildTreeListItems([empty], {
      mode: "create-file",
      parentDir: "empty",
      siblingNames,
    });
    expect(whileCreating.map((i) => i.kind)).toEqual(["node", "edit"]);
  });

  it("does NOT add an empty-hint for unloaded or loading dirs", () => {
    const unloaded = makeDirRow("lazy", {
      isOpen: true,
      data: { id: "lazy", name: "lazy", path: "lazy", type: "dir", loaded: false },
    });
    expect(buildTreeListItems([unloaded], null).map((i) => i.kind)).toEqual(["node"]);

    const loading = makeDirRow("busy", { isOpen: true, isLoading: true });
    expect(buildTreeListItems([loading], null).map((i) => i.kind)).toEqual(["node"]);
  });
});

describe("computeStickyPushPx", () => {
  it("is 0 with no sub-row offset or no sticky stack", () => {
    expect(computeStickyPushPx(4 * ROW, ROW, () => 2)).toBe(0); // exact boundary
    expect(computeStickyPushPx(4 * ROW + 13, ROW, () => 0)).toBe(0); // no stack
  });

  it("is 0 while the next unit keeps the same (or deeper) stack", () => {
    expect(computeStickyPushPx(4 * ROW + 13, ROW, () => 2)).toBe(0);
    expect(
      computeStickyPushPx(4 * ROW + 13, ROW, (u) => (u === 4 ? 1 : 2)),
    ).toBe(0);
  });

  it("pushes by the scroll fraction × depth delta when the stack is about to shrink", () => {
    // Half a row into unit 4; depth drops 2 → 1 at unit 5 → push half a row.
    const half = computeStickyPushPx(4 * ROW + ROW / 2, ROW, (u) => (u === 4 ? 2 : 1));
    expect(half).toBe(ROW / 2);
    // Depth drops 2 → 0 → push a full row at half fraction (delta 2).
    const double = computeStickyPushPx(4 * ROW + ROW / 2, ROW, (u) => (u === 4 ? 2 : 0));
    expect(double).toBe(ROW);
  });
});

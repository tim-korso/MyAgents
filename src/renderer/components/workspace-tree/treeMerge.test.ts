import { describe, expect, it, vi } from "vitest";

import type { DirectoryTreeNode } from "../../../shared/dir-types";

import {
  applyChildrenMap,
  collectFreshUpdates,
  collectLazyBoundariesInOpenSet,
  mergeLazyChildren,
  treeNodeEqual,
} from "./treeMerge";

function dir(
  path: string,
  children: DirectoryTreeNode[] | undefined,
  loaded: boolean | undefined = true,
): DirectoryTreeNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "dir",
    children,
    loaded,
  };
}

function file(path: string): DirectoryTreeNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
  };
}

describe("mergeLazyChildren", () => {
  it("returns newNode unchanged when oldNode is undefined", () => {
    const a = dir("/a", [file("/a/f")]);
    expect(mergeLazyChildren(a, undefined)).toBe(a);
  });

  it("carries old children when old is loaded:true and new is at depth boundary", () => {
    const oldNode = dir("/a", [file("/a/deep1"), file("/a/deep2")], true);
    const newNode = dir("/a", undefined, false);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.loaded).toBe(true);
    expect(merged.children).toEqual([file("/a/deep1"), file("/a/deep2")]);
  });

  it("recursively merges children when both are loaded", () => {
    const oldNode = dir(
      "/a",
      [dir("/a/b", [file("/a/b/deep")], true)],
      true,
    );
    const newNode = dir("/a", [dir("/a/b", undefined, false)], true);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.children?.[0].loaded).toBe(true);
    expect(merged.children?.[0].children).toEqual([file("/a/b/deep")]);
  });

  it("returns newNode when type mismatch (file vs dir at same path)", () => {
    const oldNode = file("/a");
    const newNode = dir("/a", [file("/a/f")]);
    expect(mergeLazyChildren(newNode, oldNode)).toBe(newNode);
  });

  it("does NOT carry old children when new is loaded:true with empty children", () => {
    // User deleted all files in the dir — new tree has loaded:true + [].
    // Carrying old children would resurrect deleted files. Case 1 (carry)
    // only fires for loaded:false on the new side.
    const oldNode = dir("/a", [file("/a/old")], true);
    const newNode = dir("/a", [], true);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.children).toEqual([]);
  });

  it("ignores old children for paths not present in new tree", () => {
    // A child existed in old, was deleted on disk, new fetch omits it. The
    // merge should not resurrect it.
    const oldNode = dir(
      "/a",
      [file("/a/keep"), file("/a/deleted")],
      true,
    );
    const newNode = dir("/a", [file("/a/keep")], true);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.children?.map((c) => c.path)).toEqual(["/a/keep"]);
  });

  it("treats old loaded:undefined the same as loaded:true (carries children)", () => {
    // DirectoryTreeNode.loaded is typed `boolean | undefined`, where both
    // true and undefined mean "fully loaded". Carry-children fires for both.
    const oldNode = dir("/a", [file("/a/x")], undefined);
    const newNode = dir("/a", undefined, false);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.children).toEqual([file("/a/x")]);
    expect(merged.loaded).toBe(true);
  });

  it("preserves the new node reference when nothing changed during recursion", () => {
    // Both trees identical → recursive merge should not allocate a new
    // wrapper. Lets React's useMemo([directoryInfo]) skip downstream work.
    const oldChildren = [file("/a/x"), file("/a/y")];
    const newChildren = [file("/a/x"), file("/a/y")];
    const oldNode = dir("/a", oldChildren, true);
    const newNode = dir("/a", newChildren, true);
    expect(mergeLazyChildren(newNode, oldNode)).toBe(newNode);
  });

  it("does NOT carry old children when old has no children defined", () => {
    // Pathological: old.loaded says "loaded" but children is undefined.
    // The carry path requires actual children to copy — fall through.
    const oldNode = dir("/a", undefined, true);
    const newNode = dir("/a", undefined, false);
    const merged = mergeLazyChildren(newNode, oldNode);
    expect(merged.loaded).toBe(false);
    expect(merged.children).toBeUndefined();
  });
});

describe("treeNodeEqual", () => {
  it("returns true for two structurally identical trees (the no-op refresh case)", () => {
    // The flicker root cause: `dirTree()` returns fresh objects every call.
    // Two scans of an unchanged tree must compare equal so the caller can keep
    // the previous reference and skip the re-render.
    const a = dir("/root", [file("/root/x"), dir("/root/d", [file("/root/d/y")])]);
    const b = dir("/root", [file("/root/x"), dir("/root/d", [file("/root/d/y")])]);
    expect(a).not.toBe(b);
    expect(treeNodeEqual(a, b)).toBe(true);
  });

  it("returns true for the same reference (fast path)", () => {
    const a = dir("/root", [file("/root/x")]);
    expect(treeNodeEqual(a, a)).toBe(true);
  });

  it("returns false when a file is added", () => {
    const a = dir("/root", [file("/root/x")]);
    const b = dir("/root", [file("/root/x"), file("/root/new")]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("returns false when a file is removed", () => {
    const a = dir("/root", [file("/root/x"), file("/root/gone")]);
    const b = dir("/root", [file("/root/x")]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("returns false when a leaf is renamed (path/name/id differ)", () => {
    const a = dir("/root", [file("/root/old")]);
    const b = dir("/root", [file("/root/new")]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("returns false when children are reordered (dirTree sorts deterministically)", () => {
    const a = dir("/root", [file("/root/a"), file("/root/b")]);
    const b = dir("/root", [file("/root/b"), file("/root/a")]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("treats loaded:true and loaded:undefined as equal", () => {
    const a = dir("/a", [file("/a/x")], true);
    const b = dir("/a", [file("/a/x")], undefined);
    expect(treeNodeEqual(a, b)).toBe(true);
  });

  it("returns false when one node is loaded:false and the other is loaded", () => {
    const a = dir("/a", undefined, false);
    const b = dir("/a", undefined, true);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("returns false when one has a children array and the other has none", () => {
    // loaded-empty dir ([]) vs unloaded dir (undefined) are different display
    // states even though both render no rows.
    const a = dir("/a", [], true);
    const b = dir("/a", undefined, true);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("returns false when a file becomes a dir at the same path", () => {
    const a = file("/a");
    const b = dir("/a", [file("/a/child")]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("detects a deeply nested change", () => {
    const a = dir("/r", [dir("/r/a", [dir("/r/a/b", [file("/r/a/b/leaf")])])]);
    const b = dir("/r", [dir("/r/a", [dir("/r/a/b", [file("/r/a/b/CHANGED")])])]);
    expect(treeNodeEqual(a, b)).toBe(false);
  });

  it("is equal for deeply nested identical trees", () => {
    const a = dir("/r", [dir("/r/a", [dir("/r/a/b", [file("/r/a/b/leaf")])])]);
    const b = dir("/r", [dir("/r/a", [dir("/r/a/b", [file("/r/a/b/leaf")])])]);
    expect(treeNodeEqual(a, b)).toBe(true);
  });
});

describe("collectLazyBoundariesInOpenSet", () => {
  it("returns empty when openPaths is empty", () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    expect(collectLazyBoundariesInOpenSet(tree, new Set())).toEqual([]);
  });

  it("collects only lazy boundaries that are in openPaths", () => {
    const tree = dir(
      "/root",
      [
        dir("/root/a", undefined, false), // lazy + in openPaths
        dir("/root/b", undefined, false), // lazy + NOT in openPaths
        dir("/root/c", [file("/root/c/f")], true), // loaded → skipped
      ],
      true,
    );
    expect(
      collectLazyBoundariesInOpenSet(tree, new Set(["/root/a"])),
    ).toEqual(["/root/a"]);
  });

  it("does not recurse into unloaded boundaries (no children to walk)", () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    // /root/a/deep can't be reached because /root/a is unloaded.
    expect(
      collectLazyBoundariesInOpenSet(tree, new Set(["/root/a/deep"])),
    ).toEqual([]);
  });

  it("walks into loaded dirs to find deeper lazy boundaries", () => {
    const tree = dir(
      "/root",
      [
        dir(
          "/root/a",
          [dir("/root/a/b", undefined, false)],
          true,
        ),
      ],
      true,
    );
    expect(
      collectLazyBoundariesInOpenSet(tree, new Set(["/root/a/b"])),
    ).toEqual(["/root/a/b"]);
  });
});

describe("applyChildrenMap", () => {
  it("replaces children + loaded at the matching path", () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const updates = new Map([
      ["/root/a", { children: [file("/root/a/f")], loaded: true }],
    ]);
    const result = applyChildrenMap(tree, updates);
    expect(result.children?.[0].loaded).toBe(true);
    expect(result.children?.[0].children).toEqual([file("/root/a/f")]);
  });

  it("returns the same reference when no updates apply", () => {
    const tree = dir("/root", [file("/root/f")]);
    const result = applyChildrenMap(tree, new Map());
    expect(result).toBe(tree);
  });

  it("applies nested updates in one pass", () => {
    const tree = dir(
      "/root",
      [
        dir(
          "/root/a",
          [dir("/root/a/b", undefined, false)],
          true,
        ),
      ],
      true,
    );
    const updates = new Map([
      [
        "/root/a/b",
        { children: [file("/root/a/b/leaf")], loaded: true },
      ],
    ]);
    const result = applyChildrenMap(tree, updates);
    const b = result.children?.[0].children?.[0];
    expect(b?.loaded).toBe(true);
    expect(b?.children).toEqual([file("/root/a/b/leaf")]);
  });
});

describe("collectFreshUpdates", () => {
  it("returns empty map when no openPaths match boundaries", async () => {
    const tree = dir("/root", [file("/root/f")]);
    const dirExpand = vi.fn();
    const updates = await collectFreshUpdates(
      tree,
      new Set(["/root/nonexistent"]),
      dirExpand,
    );
    expect(updates.size).toBe(0);
    expect(dirExpand).not.toHaveBeenCalled();
  });

  it("fetches a single boundary and records the result", async () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const dirExpand = vi.fn(async ({ path }: { path: string }) => ({
      children: [file(`${path}/x`)],
      loaded: true,
    }));
    const updates = await collectFreshUpdates(
      tree,
      new Set(["/root/a"]),
      dirExpand,
    );
    expect(dirExpand).toHaveBeenCalledTimes(1);
    expect(updates.get("/root/a")?.children).toEqual([file("/root/a/x")]);
  });

  it("cascades when dirExpand returns deeper boundaries still in openPaths", async () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const dirExpand = vi.fn(async ({ path }: { path: string }) => {
      if (path === "/root/a") {
        return {
          children: [dir(`${path}/b`, undefined, false)],
          loaded: true,
        };
      }
      if (path === "/root/a/b") {
        return { children: [file(`${path}/leaf`)], loaded: true };
      }
      throw new Error(`unexpected: ${path}`);
    });
    const openPaths = new Set(["/root/a", "/root/a/b"]);
    const updates = await collectFreshUpdates(tree, openPaths, dirExpand);
    expect(dirExpand).toHaveBeenCalledTimes(2);
    expect(updates.get("/root/a")).toBeDefined();
    expect(updates.get("/root/a/b")?.children).toEqual([
      file("/root/a/b/leaf"),
    ]);
  });

  it("swallows individual dirExpand errors and continues other paths", async () => {
    const tree = dir(
      "/root",
      [dir("/root/a", undefined, false), dir("/root/b", undefined, false)],
      true,
    );
    const dirExpand = vi.fn(async ({ path }: { path: string }) => {
      if (path === "/root/a") throw new Error("boom");
      return { children: [file(`${path}/ok`)], loaded: true };
    });
    const updates = await collectFreshUpdates(
      tree,
      new Set(["/root/a", "/root/b"]),
      dirExpand,
      { onError: () => {} }, // silence the default console.warn for this test
    );
    expect(updates.has("/root/a")).toBe(false);
    expect(updates.get("/root/b")?.children).toEqual([file("/root/b/ok")]);
  });

  it("stops early when every fetch in a round fails (no progress)", async () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const dirExpand = vi.fn(async () => {
      throw new Error("nope");
    });
    const updates = await collectFreshUpdates(
      tree,
      new Set(["/root/a"]),
      dirExpand,
      { onError: () => {} },
    );
    // One round of failing fetches, then bail — not maxIterations attempts.
    expect(dirExpand).toHaveBeenCalledTimes(1);
    expect(updates.size).toBe(0);
  });

  it("respects maxIterations safety cap on infinite cascades", async () => {
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const dirExpand = vi.fn(async ({ path }: { path: string }) => ({
      // Every expansion produces another unloaded boundary one level deeper.
      children: [dir(`${path}/deeper`, undefined, false)],
      loaded: true,
    }));
    const openPathsArr: string[] = ["/root/a"];
    let p = "/root/a";
    for (let i = 0; i < 30; i++) {
      p += "/deeper";
      openPathsArr.push(p);
    }
    await collectFreshUpdates(
      tree,
      new Set(openPathsArr),
      dirExpand,
      { maxIterations: 3 },
    );
    expect(dirExpand.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("honours concurrency cap (no more than N in-flight)", async () => {
    const tree = dir(
      "/root",
      Array.from({ length: 12 }, (_, i) =>
        dir(`/root/d${i}`, undefined, false),
      ),
      true,
    );
    let inFlight = 0;
    let peak = 0;
    const dirExpand = vi.fn(async ({ path }: { path: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { children: [file(`${path}/x`)], loaded: true };
    });
    const openPaths = new Set(
      Array.from({ length: 12 }, (_, i) => `/root/d${i}`),
    );
    await collectFreshUpdates(tree, openPaths, dirExpand, {
      maxConcurrency: 3,
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(dirExpand).toHaveBeenCalledTimes(12);
  });

  it("skips paths the user is currently loading (isLoading predicate)", async () => {
    // User clicked dir /a — expandDir is in-flight. The refresh should not
    // refetch /a (let user's expand commit). It still refetches /b.
    const tree = dir(
      "/root",
      [dir("/root/a", undefined, false), dir("/root/b", undefined, false)],
      true,
    );
    const dirExpand = vi.fn(async ({ path }: { path: string }) => ({
      children: [file(`${path}/x`)],
      loaded: true,
    }));
    const loading = new Set(["/root/a"]);
    const updates = await collectFreshUpdates(
      tree,
      new Set(["/root/a", "/root/b"]),
      dirExpand,
      { isLoading: (p) => loading.has(p) },
    );
    expect(dirExpand).toHaveBeenCalledTimes(1);
    expect(dirExpand).toHaveBeenCalledWith({ path: "/root/b" });
    expect(updates.has("/root/a")).toBe(false);
    expect(updates.has("/root/b")).toBe(true);
  });

  it("short-circuits between rounds when shouldContinue returns false", async () => {
    // A newer refresh started → caller flips the predicate → we stop
    // burning IPC.
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    let cancelled = false;
    const dirExpand = vi.fn(async ({ path }: { path: string }) => {
      cancelled = true; // caller cancels after first fetch starts
      return {
        children: [dir(`${path}/b`, undefined, false)],
        loaded: true,
      };
    });
    await collectFreshUpdates(
      tree,
      new Set(["/root/a", "/root/a/b"]),
      dirExpand,
      { shouldContinue: () => !cancelled },
    );
    // First round fetched /root/a. After it returns, cancelled=true → no
    // second round even though /root/a/b is a boundary in openPaths.
    expect(dirExpand).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a path that keeps returning loaded:false in one cascade", async () => {
    // Adversarial: server returns loaded:false for the same path forever.
    // Without dedup we'd burn maxIterations rounds; with `attempted` we
    // attempt it exactly once.
    const tree = dir("/root", [dir("/root/a", undefined, false)], true);
    const dirExpand = vi.fn(async () => ({
      children: [] as DirectoryTreeNode[],
      loaded: false,
    }));
    await collectFreshUpdates(tree, new Set(["/root/a"]), dirExpand);
    expect(dirExpand).toHaveBeenCalledTimes(1);
    expect(dirExpand).toHaveBeenCalledWith({ path: "/root/a" });
  });

  it("calls onError for individual failures", async () => {
    const tree = dir(
      "/root",
      [dir("/root/a", undefined, false), dir("/root/b", undefined, false)],
      true,
    );
    const err = new Error("permission denied");
    const dirExpand = vi.fn(async ({ path }: { path: string }) => {
      if (path === "/root/a") throw err;
      return { children: [file(`${path}/ok`)], loaded: true };
    });
    const onError = vi.fn();
    await collectFreshUpdates(
      tree,
      new Set(["/root/a", "/root/b"]),
      dirExpand,
      { onError },
    );
    expect(onError).toHaveBeenCalledWith("/root/a", err);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

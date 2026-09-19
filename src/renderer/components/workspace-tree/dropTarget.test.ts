import { describe, expect, it } from "vitest";

import type { DirectoryTreeNode } from "../../../shared/dir-types";
import type { WorkspaceTreeNodeMeta } from "./treeTypes";

import {
  EMPTY_HINT_DROP_PREFIX,
  parseDropId,
  resolveExternalDropDir,
  resolveInternalDropTarget,
  ROOT_DROP_ID,
  STICKY_DROP_PREFIX,
} from "./dropTarget";

function metaMap(
  entries: Array<{ path: string; type: "file" | "dir"; parentPath?: string | null }>,
): Map<string, WorkspaceTreeNodeMeta> {
  const map = new Map<string, WorkspaceTreeNodeMeta>();
  for (const e of entries) {
    const data: DirectoryTreeNode = {
      id: e.path,
      name: e.path.split("/").pop() ?? e.path,
      path: e.path,
      type: e.type,
    };
    map.set(e.path, {
      data,
      depth: e.path.split("/").length - 1,
      parentPath: e.parentPath ?? null,
    });
  }
  return map;
}

const META = metaMap([
  { path: "docs", type: "dir", parentPath: null },
  { path: "docs/notes", type: "dir", parentPath: "docs" },
  { path: "docs/notes/a.md", type: "file", parentPath: "docs/notes" },
  { path: "docs/readme.md", type: "file", parentPath: "docs" },
  { path: "root.md", type: "file", parentPath: null },
  { path: "docs-extra", type: "dir", parentPath: null },
]);

describe("parseDropId", () => {
  it("extracts the path from drop ids and rejects everything else", () => {
    expect(parseDropId("drop:docs/notes")).toBe("docs/notes");
    expect(parseDropId(ROOT_DROP_ID)).toBe("");
    expect(parseDropId("drag:docs")).toBeNull();
    expect(parseDropId(null)).toBeNull();
  });

  it("extracts the path from sticky breadcrumb drop ids", () => {
    expect(parseDropId(`${STICKY_DROP_PREFIX}docs/notes`)).toBe("docs/notes");
  });

  it("extracts the dir from empty-hint drop ids (the hint stands in for its dir)", () => {
    expect(parseDropId(`${EMPTY_HINT_DROP_PREFIX}docs/notes`)).toBe("docs/notes");
  });
});

describe("resolveInternalDropTarget via empty-hint ids", () => {
  it("targets the empty folder the hint row represents", () => {
    expect(
      resolveInternalDropTarget(`${EMPTY_HINT_DROP_PREFIX}docs/notes`, ["root.md"], META),
    ).toBe("docs/notes");
  });
});

describe("resolveInternalDropTarget via sticky breadcrumb ids", () => {
  it("targets the breadcrumb's folder (the bar visually owns the top rows)", () => {
    expect(
      resolveInternalDropTarget(`${STICKY_DROP_PREFIX}docs/notes`, ["root.md"], META),
    ).toBe("docs/notes");
  });

  it("still applies self/descendant and no-op guards", () => {
    expect(
      resolveInternalDropTarget(`${STICKY_DROP_PREFIX}docs`, ["docs"], META),
    ).toBeNull();
    expect(
      resolveInternalDropTarget(`${STICKY_DROP_PREFIX}docs/notes`, ["docs/notes/a.md"], META),
    ).toBeNull();
  });
});

describe("resolveExternalDropDir", () => {
  it("maps dir → itself, file → parent, blank/unknown → root", () => {
    expect(resolveExternalDropDir("docs/notes", META)).toBe("docs/notes");
    expect(resolveExternalDropDir("docs/notes/a.md", META)).toBe("docs/notes");
    expect(resolveExternalDropDir("root.md", META)).toBe("");
    expect(resolveExternalDropDir(null, META)).toBe("");
    expect(resolveExternalDropDir("gone/away.md", META)).toBe("");
  });
});

describe("resolveInternalDropTarget", () => {
  it("returns null when the pointer is outside the tree (over=null) — pre-fix this silently moved items to the root", () => {
    expect(resolveInternalDropTarget(null, ["docs/notes/a.md"], META)).toBeNull();
  });

  it("targets the workspace root via the explicit root zone", () => {
    expect(
      resolveInternalDropTarget(ROOT_DROP_ID, ["docs/notes/a.md"], META),
    ).toBe("");
  });

  it("targets a directory row directly", () => {
    expect(
      resolveInternalDropTarget("drop:docs/notes", ["root.md"], META),
    ).toBe("docs/notes");
  });

  it("maps a FILE row to its parent directory (VS Code semantics) — pre-fix this fell through to the root", () => {
    expect(
      resolveInternalDropTarget("drop:docs/notes/a.md", ["root.md"], META),
    ).toBe("docs/notes");
  });

  it("maps a root-level file row to the workspace root", () => {
    expect(
      resolveInternalDropTarget("drop:root.md", ["docs/readme.md"], META),
    ).toBe("");
  });

  it("returns null for a row missing from the meta map (stale id mid-refresh)", () => {
    expect(
      resolveInternalDropTarget("drop:gone/away.md", ["root.md"], META),
    ).toBeNull();
  });

  it("refuses dropping a folder onto itself or into its own subtree", () => {
    expect(resolveInternalDropTarget("drop:docs", ["docs"], META)).toBeNull();
    expect(
      resolveInternalDropTarget("drop:docs/notes", ["docs"], META),
    ).toBeNull();
    // Sibling with a shared name prefix is NOT a descendant.
    expect(
      resolveInternalDropTarget("drop:docs-extra", ["docs"], META),
    ).toBe("docs-extra");
  });

  it("suppresses no-op drops (every source already directly inside the target)", () => {
    expect(
      resolveInternalDropTarget("drop:docs/notes", ["docs/notes/a.md"], META),
    ).toBeNull();
    // Dropping a file onto a SIBLING file maps to their shared parent → no-op.
    expect(
      resolveInternalDropTarget("drop:docs/readme.md", ["docs/readme.md"], META),
    ).toBeNull();
    // Mixed parents → not a no-op.
    expect(
      resolveInternalDropTarget("drop:docs/notes", ["docs/notes/a.md", "root.md"], META),
    ).toBe("docs/notes");
  });
});

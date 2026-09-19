import { describe, expect, it } from "vitest";

import {
  buildUndoPlan,
  pushUndoEntry,
  UNDO_JOURNAL_CAP,
  type UndoableOp,
} from "./undoJournal";

describe("buildUndoPlan", () => {
  it("reverses a move back to the original dir AND the original name (forward auto-rename)", () => {
    const plan = buildUndoPlan({
      kind: "move",
      moves: [
        { from: "docs/a.md", to: "archive/a.md" },
        // Forward move collided and auto-renamed.
        { from: "docs/b.md", to: "archive/b (1).md" },
      ],
    });
    expect(plan).toEqual([
      { op: "move", sourcePath: "archive/b (1).md", targetDir: "docs", desiredName: "b.md" },
      { op: "move", sourcePath: "archive/a.md", targetDir: "docs", desiredName: "a.md" },
    ]);
  });

  it("reverses a rename with the RENAME primitive (a same-dir move would no-op in Rust)", () => {
    const plan = buildUndoPlan({ kind: "rename", from: "docs/old.md", to: "docs/new.md" });
    expect(plan).toEqual([{ op: "rename", path: "docs/new.md", newName: "old.md" }]);
  });

  it("root-level renames reverse the same way", () => {
    const plan = buildUndoPlan({ kind: "rename", from: "old.md", to: "new.md" });
    expect(plan).toEqual([{ op: "rename", path: "new.md", newName: "old.md" }]);
  });

  it("creates and paste-copies undo by deleting (to trash)", () => {
    expect(buildUndoPlan({ kind: "create", paths: ["note.md"] })).toEqual([
      { op: "delete", path: "note.md" },
    ]);
    expect(
      buildUndoPlan({ kind: "copy", createdPaths: ["a_1.md", "dir_1"] }),
    ).toEqual([
      { op: "delete", path: "a_1.md" },
      { op: "delete", path: "dir_1" },
    ]);
  });
});

describe("pushUndoEntry", () => {
  it("appends and caps the journal", () => {
    let journal: UndoableOp[] = [];
    for (let i = 0; i < UNDO_JOURNAL_CAP + 5; i += 1) {
      journal = pushUndoEntry(journal, { kind: "create", paths: [`f${i}`] });
    }
    expect(journal).toHaveLength(UNDO_JOURNAL_CAP);
    expect(journal[journal.length - 1]).toEqual({
      kind: "create",
      paths: [`f${UNDO_JOURNAL_CAP + 4}`],
    });
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateItemName } from "./nameValidation";

// TS side of the Rust↔renderer name-rule crosscheck (cross-review 0.2.33,
// architecture review). `validateItemName` is a hand-written mirror of Rust
// `path_safety::validate_item_name` — Rust stays the authority (fail-closed),
// but a drifted mirror silently degrades the inline editor's live feedback
// into a confusing Rust error round-trip. Both sides assert against the same
// fixture so a rule change on either side breaks one of the two suites.
// Loading pattern mirrors path-safety-crosscheck.unit.test.ts.
const cases = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/shared/item-name-validation-cases.json"),
    "utf-8",
  ),
) as { valid: string[]; invalid: string[] };

describe("validateItemName — fixture crosscheck with Rust validate_item_name", () => {
  it.each(cases.valid)("accepts %j", (name) => {
    expect(validateItemName(name)).toBeNull();
  });

  it.each(cases.invalid)("rejects %j", (name) => {
    expect(validateItemName(name)).not.toBeNull();
  });
});

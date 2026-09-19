// Shared error-parsing helper for Task Center surfaces.
//
// Rust's `TaskOpError` is serialized as a JSON-stringified `{code, message}`
// via `Display`; the renderer-facing Tauri commands then surface it as a
// plain string in the JS error channel. Every caller was running its own
// inline `JSON.parse` to pluck `message` — this consolidates the parser
// so any future code-based branching (`NotFound` vs `UpdateRejectedWhile
// Running` etc.) has a single place to grow.

export interface TaskOpErrorShape {
  code?: string;
  message: string;
}

/**
 * Parse a thrown value from a Tauri `cmd_task_*` command. Returns a
 * structured object when the payload is a TaskOpError JSON string;
 * otherwise wraps the raw string in `{ message }`.
 */
export function parseTaskError(e: unknown): TaskOpErrorShape {
  const raw = String(e);
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    if (parsed && typeof parsed.message === 'string') {
      return { code: parsed.code, message: parsed.message };
    }
  } catch {
    /* not JSON — fall through */
  }
  return { message: raw };
}

/** Convenience: return just the user-facing message string. */
export function extractErrorMessage(e: unknown): string {
  return parseTaskError(e).message;
}

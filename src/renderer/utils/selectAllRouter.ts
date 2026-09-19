/**
 * selectAllRouter — decides who owns ⌘/Ctrl+A "select all" for the focused element.
 *
 * ## Why this exists
 *
 * The native macOS Edit menu used to carry a predefined `Select All` item, which
 * registered ⌘A as the AppKit `selectAll:` key-equivalent. Because the renderer is a
 * Wry child WebView whose `performKeyEquivalent:` returns NO (so the app menu can own
 * shortcuts), macOS dispatched ⌘A to `selectAll:` *before* any DOM `keydown` reached
 * the WebView. Unlike `copy:`/`cut:`/`paste:` (which WebKit translates into DOM
 * clipboard events), `selectAll:` has no
 * DOM-event translation — so Monaco's built-in ⌘A keybinding, the workspace tree's
 * `resolveTreeKeyAction`, and every other custom WebView editor never saw the event.
 * Net effect: ⌘A silently did nothing in Monaco/tree while "working" only in plain
 * <input>/<textarea> (where `selectAll:` routes to the native field). See the matching
 * NOTE in `src-tauri/src/lib.rs` for the menu change.
 *
 * Removing the menu item lets ⌘A fall through to the normal `keydown` path (exactly how
 * ⌘T/⌘Y/⌘U/⌘1-9 already reach `App.tsx`). Once it does:
 *   - Monaco owns it via its built-in `editor.action.selectAll` keybinding.
 *   - The workspace tree owns it via its `onKeyDown` → `resolveTreeKeyAction`.
 *   - A plain <input>/<textarea> has NO JS owner — it would depend on WKWebView applying
 *     a default editing command for ⌘A, which is undocumented. The chat input is far too
 *     load-bearing to gamble on that, so we own that one case explicitly and
 *     deterministically (and uniformly across macOS/Windows/Linux).
 *
 * This is the Functional Core: a DOM-free pure decision, unit-tested in the fast pool.
 * The imperative shell (`handleSelectAllKeydown`) reads `document.activeElement`, asks
 * this function who should handle it, and only acts when the answer is `native-text`.
 */

/** Who should handle a ⌘/Ctrl+A press. */
export type SelectAllTarget =
  /** A plain text <input>/<textarea> — we call `.select()` ourselves. */
  | 'native-text'
  /** Monaco, the workspace tree, or nothing focused — leave ⌘A to their own handlers. */
  | 'delegate';

/** Structural snapshot of the focused element — keeps the decision DOM-free. */
export interface SelectAllFocusInfo {
  /** `element.tagName` (upper-case, per the DOM spec). */
  tagName: string;
  /** `<input>.type`, when the element is an INPUT. */
  inputType?: string;
  /** Whether the element sits inside a Monaco editor (`.closest('.monaco-editor')`). */
  insideMonaco: boolean;
}

/**
 * Text-like <input> types where "select all" is meaningful. Deliberately excludes
 * checkbox/radio/range/color/file/button/etc., where ⌘A should do nothing special.
 */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
]);

/**
 * Pure decision: given the focused element's shape, who owns ⌘A?
 *
 * Monaco is checked first because its backing element is itself a (hidden) <textarea>;
 * without the `insideMonaco` guard we'd wrongly `.select()` that tiny composition buffer
 * — the exact failure mode of the original bug. Everything that isn't a plain text
 * control delegates (Monaco built-in, tree handler, or no-op).
 */
export function resolveSelectAllTarget(info: SelectAllFocusInfo | null): SelectAllTarget {
  if (!info) return 'delegate';
  if (info.insideMonaco) return 'delegate';
  if (info.tagName === 'TEXTAREA') return 'native-text';
  if (info.tagName === 'INPUT') {
    // An <input> with no/unknown type defaults to "text".
    return TEXT_INPUT_TYPES.has(info.inputType ?? 'text') ? 'native-text' : 'delegate';
  }
  return 'delegate';
}

/** Imperative shell: snapshot a focused DOM element into the pure decision's input. */
function focusInfoFrom(active: Element | null): SelectAllFocusInfo | null {
  if (!active) return null;
  return {
    tagName: active.tagName,
    inputType: active instanceof HTMLInputElement ? active.type : undefined,
    insideMonaco: !!active.closest('.monaco-editor'),
  };
}

/**
 * Window-level ⌘/Ctrl+A handler. Returns true iff it owned the event (a plain text
 * control was focused → selected + default prevented). For everything else it returns
 * false WITHOUT touching the event, so the press bubbles on to Monaco's built-in
 * keybinding or the workspace tree's `onKeyDown`.
 */
export function handleSelectAllKeydown(e: KeyboardEvent, isMac: boolean): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.shiftKey || e.altKey) return false;
  if (e.key.toLowerCase() !== 'a' && e.code !== 'KeyA') return false;

  const active = document.activeElement;
  if (resolveSelectAllTarget(focusInfoFrom(active)) !== 'native-text') return false;

  e.preventDefault();
  (active as HTMLInputElement | HTMLTextAreaElement).select();
  return true;
}

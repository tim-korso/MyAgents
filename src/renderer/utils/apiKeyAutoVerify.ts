/**
 * Pure decision for whether a key change should trigger debounced auto-verify
 * against the provider. See Settings.tsx `handleSaveApiKey`.
 *
 * Background — issue #306: typing backspace in the API key input fired a verify
 * cycle for every keystroke whose 500ms debounce slot was wide enough not to be
 * cancelled by the next backspace. For a slow-deleter clearing an expired key
 * this surfaced as a stack of "key invalid" toasts. We don't want a verify
 * during deletion at all — the user's intent is to remove the key, not test
 * intermediate prefixes.
 *
 * Rule: skip verify only for an actual DELETION — an empty value, or a
 * backspace/trim from the END (the new value is a strict prefix of the old).
 * That's the #306 pattern (slow-deleter clearing an expired key) and the only
 * case we confidently read as "removing", not "testing".
 *
 * Everything else verifies, including a select-all + paste of a SHORTER but
 * still valid key: the previous "any length decrease = deletion" rule wrongly
 * suppressed that legitimate replacement (review). A shorter paste is not a
 * prefix of the old key, so it now correctly triggers verification.
 */
export function shouldDebounceAutoVerify(prevKey: string, newKey: string): boolean {
  if (!newKey) return false;
  // Strict prefix + shorter ⇒ characters trimmed from the end (backspace/cut at
  // tail). Treat as deletion, skip. A shorter REPLACEMENT differs in content,
  // so it fails this test and falls through to verify.
  if (newKey.length < prevKey.length && prevKey.startsWith(newKey)) return false;
  return true;
}

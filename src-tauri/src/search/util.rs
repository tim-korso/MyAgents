//! UTF-8 / UTF-16 indexing helpers for search snippet + highlight code.
//!
//! The search layer finds matches in Rust `str` (UTF-8 byte-indexed) but the
//! frontend consumes highlights as offsets into JavaScript strings
//! (UTF-16-code-unit-indexed). Using raw byte offsets produces wildly wrong
//! highlights for Chinese content (3 UTF-8 bytes vs 1 UTF-16 unit per CJK
//! character), so every offset crossing the Rust→JS boundary is converted
//! here.
//!
//! These helpers also provide panic-free char-boundary clamping. Naive byte
//! slicing of Chinese/emoji text panics mid-codepoint; `floor_char_boundary`
//! and `ceil_char_boundary` let callers work with approximate byte offsets
//! (e.g., "match_pos − half") without crashing.

/// Convert a byte offset within `text` to a UTF-16 code unit offset.
///
/// `byte_offset` is clamped to `text.len()`. If it lands mid-codepoint, the
/// next whole codepoint boundary is used.
pub fn byte_to_utf16(text: &str, byte_offset: usize) -> usize {
    let byte_offset = byte_offset.min(text.len());
    let mut utf16 = 0usize;
    let mut bytes = 0usize;
    for ch in text.chars() {
        if bytes >= byte_offset {
            break;
        }
        bytes += ch.len_utf8();
        utf16 += ch.len_utf16();
    }
    utf16
}

/// Clamp `idx` down to the nearest UTF-8 char boundary `≤ idx`.
/// Returns `text.len()` if `idx` is past the end.
pub fn floor_char_boundary(text: &str, idx: usize) -> usize {
    if idx >= text.len() {
        return text.len();
    }
    let mut i = idx;
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Clamp `idx` up to the nearest UTF-8 char boundary `≥ idx`.
/// Returns `text.len()` if `idx` is past the end.
pub fn ceil_char_boundary(text: &str, idx: usize) -> usize {
    if idx >= text.len() {
        return text.len();
    }
    let mut i = idx;
    while i < text.len() && !text.is_char_boundary(i) {
        i += 1;
    }
    i
}

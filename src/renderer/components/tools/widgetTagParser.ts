/**
 * Widget Tag Parser — Extracts <generative-ui-widget> tags from streaming text.
 *
 * Splits text content into segments: plain text and widget blocks.
 * Used by Message.tsx to render widgets inline with Markdown content.
 *
 * Handles:
 * - Complete widgets: <generative-ui-widget title="xxx">HTML</generative-ui-widget>
 * - Partial/streaming widgets: <generative-ui-widget title="xxx">partial HTML...
 * - Multiple widgets in a single text block
 * - Text before, between, and after widgets
 * - Tags inside code fences are ignored (not treated as real widgets)
 * - Single or double quotes for title attribute
 * - Extra attributes on the tag (ignored, only title extracted)
 */

export interface WidgetSegment {
  type: 'widget';
  title: string;
  code: string;
  isComplete: boolean;
}

export interface TextSegment {
  type: 'text';
  content: string;
}

export type Segment = TextSegment | WidgetSegment;

// Tag name used for widget output — unique enough to avoid accidental collisions
const TAG_NAME = 'generative-ui-widget';

// Source for the opening tag: <generative-ui-widget> or
// <generative-ui-widget title="xxx">. Title is optional — captured if present
// (group 1), empty string if absent. NOT line-start anchored: placement is
// judged at runtime in findNextWidget (see below), because a hard line-start
// gate silently dropped real widgets that weaker / non-Claude models emit
// mid-line (issue #221). A `g` instance is created per scan to walk candidates.
const WIDGET_OPEN_SRC = `<${TAG_NAME}(?:\\s+[^>]*?title\\s*=\\s*["']([^"']+)["'][^>]*|\\s*)>`;
// Match closing tag
const WIDGET_CLOSE_STR = `</${TAG_NAME}>`;

interface FoundWidget {
  openStart: number;
  openEnd: number;
  title: string;
  closeIdx: number; // absolute index of the closing tag, or -1 if none (streaming)
  isComplete: boolean;
}

/**
 * Find the next *real* widget in `masked` (code-region-masked) text, returning
 * indices into the parallel `original` string. A candidate `<generative-ui-widget>`
 * tag is accepted as a real widget when it is EITHER:
 *   - at line start (the contract's compliant shape — possibly still streaming
 *     with no closing tag yet), OR
 *   - followed by a matching `</generative-ui-widget>` (a self-contained closed
 *     widget — what non-Claude models emit mid-line, issue #221).
 *
 * A mid-line candidate is accepted ONLY when it is fully closed AND its body
 * begins with an HTML tag (the contract's `<style>`/`<div>`/`<canvas>` shape).
 * That admits the mid-line widgets weaker models emit while rejecting prose
 * that merely mentions both tag strings ("output a <generative-ui-widget> and
 * end with </generative-ui-widget>") — the false-positive bee4ba6b guarded
 * against. Inline-code and fenced mentions are already NUL-masked by the caller.
 */
function findNextWidget(masked: string, original: string): FoundWidget | null {
  const openRe = new RegExp(WIDGET_OPEN_SRC, 'gi');
  const closeStr = WIDGET_CLOSE_STR.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(masked)) !== null) {
    if (m[0].length === 0) { openRe.lastIndex++; continue; } // defensive
    const openStart = m.index;
    const openEnd = m.index + m[0].length;

    // Line start = preceded by start-of-text or `\n` (after optional indent).
    let j = openStart;
    while (j > 0 && (masked[j - 1] === ' ' || masked[j - 1] === '\t')) j--;
    const isLineStart = j === 0 || masked[j - 1] === '\n';

    // Bound the close search by the next LINE-START widget open, so widget A
    // can't consume a genuinely separate widget B's closing tag. We bound only
    // on a line-start open (the contract-compliant shape of a real top-level
    // widget): a MID-LINE open match is either a weak-model inline widget
    // (parsed in its own scan iteration) or — the bug this guards — a literal
    // `<generative-ui-widget>` tag-name string sitting inside THIS widget's own
    // JS/HTML body. Bounding on ANY open match (the previous behaviour) let such
    // a literal cut the window short, so `lastIndexOf` missed the real close and
    // the whole widget was mis-flagged `isComplete:false`, swallowing the rest
    // of the message. Search in `masked` (NOT `original`) so a close that only
    // appears inside inline-code / fenced prose ("end with
    // `</generative-ui-widget>`") doesn't count. lastIndexOf within the bound
    // stays robust to a literal close-tag string sitting in the widget's own JS.
    const boundRe = new RegExp(WIDGET_OPEN_SRC, 'gi');
    boundRe.lastIndex = openEnd;
    let searchEnd = masked.length;
    let bm: RegExpExecArray | null;
    while ((bm = boundRe.exec(masked)) !== null) {
      let bk = bm.index;
      while (bk > 0 && (masked[bk - 1] === ' ' || masked[bk - 1] === '\t')) bk--;
      if (bk === 0 || masked[bk - 1] === '\n') { searchEnd = bm.index; break; }
    }
    const closeRel = masked.slice(openEnd, searchEnd).toLowerCase().lastIndexOf(closeStr);
    const closeIdx = closeRel === -1 ? -1 : openEnd + closeRel;

    if (isLineStart) {
      // Contract-compliant placement — trust it (may still be streaming, no close yet).
      return { openStart, openEnd, title: m[1] || '', closeIdx, isComplete: closeIdx !== -1 };
    }
    // Mid-line: require a real closed widget whose body opens with an element
    // tag (`<` + a letter — so an HTML comment `<!--`, a stray `</`, or prose
    // don't qualify).
    if (closeIdx !== -1 && /^<[a-zA-Z]/.test(original.slice(openEnd, closeIdx).trimStart())) {
      return { openStart, openEnd, title: m[1] || '', closeIdx, isComplete: true };
    }
    // Otherwise a bare mention — leave it in the text and keep scanning.
  }
  return null;
}

/**
 * Mask code regions (fenced blocks AND inline code spans) before scanning for
 * widget tags. Without inline-code masking, a literal mention like
 * `` `<generative-ui-widget>` `` matches the open regex and the parser then
 * treats everything up to a (non-existent) closing tag as widget HTML.
 * Same-length NUL placeholder preserves character indices for downstream slicing.
 */
function maskCodeRegions(text: string): { masked: string } {
  let masked = text;
  // Fenced first — protects ` characters inside ``` blocks from inline pass.
  masked = masked.replace(/```[\s\S]*?```/g, (match) => '\x00'.repeat(match.length));
  // Inline code spans — N backticks open, same N close. Single-line only
  // (multi-line inline code is legal per CommonMark but vanishingly rare for
  // tag mentions). Backreference `\1` ensures the closer length matches.
  masked = masked.replace(/(`+)[^\n]*?\1/g, (match) => '\x00'.repeat(match.length));
  return { masked };
}

/**
 * Parse text into segments of plain text and widget blocks.
 * Supports streaming: if text ends mid-widget (no closing tag), returns
 * the widget with isComplete=false.
 * Tags inside code fences (```) are ignored.
 */
export function parseWidgetTags(text: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;
  let maskedRemaining = maskCodeRegions(text).masked;

  while (remaining.length > 0) {
    // Search in masked text (code regions replaced) to avoid false positives.
    const found = findNextWidget(maskedRemaining, remaining);

    if (!found) {
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining });
      }
      break;
    }

    // Text before the widget tag (bare mid-line mentions stay folded in here).
    const textBefore = remaining.slice(0, found.openStart);
    if (textBefore.trim()) {
      segments.push({ type: 'text', content: textBefore });
    }

    if (found.isComplete) {
      segments.push({
        type: 'widget',
        title: found.title,
        code: remaining.slice(found.openEnd, found.closeIdx),
        isComplete: true,
      });
      const afterClose = found.closeIdx + WIDGET_CLOSE_STR.length;
      remaining = remaining.slice(afterClose);
      // Slice the running masked window, NOT the original masked text — the
      // two would only agree when starting at offset 0, so reusing the
      // original drifts the mask window after the first close.
      maskedRemaining = maskedRemaining.slice(afterClose);
    } else {
      // Partial widget (still streaming, line-start only — see findNextWidget)
      segments.push({
        type: 'widget',
        title: found.title,
        code: remaining.slice(found.openEnd),
        isComplete: false,
      });
      break;
    }
  }

  return segments;
}

/**
 * Quick check: does the text contain any real widget tags (outside code regions)?
 */
export function hasWidgetTags(text: string): boolean {
  return findNextWidget(maskCodeRegions(text).masked, text) !== null;
}

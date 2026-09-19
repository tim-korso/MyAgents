import { BlockContext, type Element, type Line, type MarkdownConfig } from '@lezer/markdown';

// GFM's stock Table is one leaf. Editing a cell in a 50,000-row table therefore
// reparses every row synchronously in LanguageState.apply. A composite table
// gives Lezer reusable row blocks, while preserving the same cell/delimiter
// source coordinates and inline parser. No editor transaction mutates a tree.
const starts = new WeakMap<BlockContext, { header: number; delimiter: number; continuedAt: number; line: Line }>();
const pendingRows = new WeakMap<BlockContext, () => void>();
const separator = /^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;
const blockTags = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i;

function startsBlock(text: string, cx: BlockContext): boolean {
  if (/^\d{1,9}[.)](?:\s|$)/.test(text) || /^[-+*]\s*$/.test(text)) {
    const kind = /^\d/.test(text) ? 'OrderedList' : 'BulletList';
    for (let depth = 0; depth < cx.depth; depth++) if (cx.parentType(depth).name === kind) return true;
  }
  if (/^(?:#{1,6}(?:\s|$)|>|[-+*]\s+\S|1[.)]\s+\S|~{3,}|`{3,}[^`]*$)/.test(text)) return true;
  if (/^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(text)) return true;
  if (/^<(?:!--|\?|![A-Z]|!\[CDATA\[)/.test(text) || /^<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(text)) return true;
  return /^<\/?/.test(text) && blockTags.test(text.replace(/^<\/?/, ''));
}

function pipes(text: string): number[] {
  const result: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '|') result.push(index);
  }
  return result;
}
function cells(text: string) {
  const delimiters = pipes(text);
  const boundaries = [-1, ...delimiters, text.length];
  const result: { from: number; to: number }[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const a = boundaries[index] + 1, b = boundaries[index + 1];
    const source = text.slice(a, b);
    if (index === 0 && !source.trim() && delimiters.length || index === boundaries.length - 2 && !source.trim()) continue;
    const from = a + (/^[ \t]*/.exec(source)?.[0].length ?? 0);
    const to = b - (/[ \t]*$/.exec(source)?.[0].length ?? 0);
    result.push({ from, to: Math.max(from, to) });
  }
  return { cells: result, delimiters };
}

function rowElements(cx: BlockContext, source: string, start: number): Element[] {
  const parsed = cells(source), elements: Element[] = [];
  for (const cell of parsed.cells) if (cell.to > cell.from) elements.push(cx.elt('TableCell', start + cell.from, start + cell.to, cx.parser.parseInline(source.slice(cell.from, cell.to), start + cell.from)));
  for (const pipe of parsed.delimiters) elements.push(cx.elt('TableDelimiter', start + pipe, start + pipe + 1));
  return elements.sort((a, b) => a.from - b.from);
}
function consumeRow(cx: BlockContext, line: Line, lazy = false) {
  const context = starts.get(cx)!;
  if (lazy) for (const marker of line.markers) cx.addElement(marker);
  const start = cx.lineStart + line.pos, end = cx.lineStart + line.text.length;
  const kind = cx.lineStart === context.header ? 'LiveTableHeader' : cx.lineStart === context.delimiter ? 'LiveTableDelimiter' : 'LiveTableRow';
  if (kind !== 'LiveTableRow') {
    cx.addElement(cx.elt(kind, start, end, kind === 'LiveTableDelimiter' ? [] : rowElements(cx, line.text.slice(line.pos), start)));
    if (cx.nextLine()) scheduleLazyRow(cx);
    return;
  }
  // Named, bounded blocks are reused as units by Lezer. Anonymous balancing
  // nodes are flattened by its fragment cursor, which otherwise copies and
  // rebalances every individual row on each edit of a fully parsed table.
  const group: Element[] = [];
  let groupEnd = end;
  for (let count = 0; count < 128; count++) {
    const rowStart = cx.lineStart + line.pos;
    groupEnd = cx.lineStart + line.text.length;
    group.push(cx.elt('LiveTableRow', rowStart, groupEnd, rowElements(cx, line.text.slice(line.pos), rowStart)));
    if (!cx.nextLine() || !continuesTable(cx, line) || count === 127 || groupEnd - start >= 16384 || cx.stoppedAt != null && cx.parsedPos > cx.stoppedAt) break;
    group.push(...line.markers);
  }
  cx.addElement(cx.elt('LiveTableRowGroup', start, groupEnd, group));
  scheduleLazyRow(cx);
}
function continuesTable(cx: BlockContext, line: Line) {
  return !!line.text.slice(line.pos).trim() && (line.indent >= line.baseIndent + 4 || !startsBlock(line.text.slice(line.pos), cx));
}
function scheduleLazyRow(cx: BlockContext) {
  const context = starts.get(cx);
  if (!context || cx.parentType().name !== 'LiveTable' || context.continuedAt === cx.lineStart) return;
  const { line } = context;
  if (!continuesTable(cx, line)) return;
  // Missing parent prefixes still continue the GFM table. Resume one group per
  // PartialParse.advance, before BlockContext would close those containers.
  // This lets CM's existing parse budget yield even on an enormous lazy chain.
  pendingRows.set(cx, () => consumeRow(cx, line, true));
}
export const incrementalTables: MarkdownConfig = {
  // Keep this wrapper before mixed code-language wrappers (the latter wrap us).
  // No parser internals or syntax-tree mutation: only the public partial-parse
  // contract and block-parser operations are used.
  wrap(inner) {
    if (!(inner instanceof BlockContext)) throw new Error('Table row scheduling must wrap the Markdown block parser before mixed parsers');
    return {
      get parsedPos() { return inner.parsedPos; },
      get stoppedAt() { return inner.stoppedAt; },
      stopAt(position) { inner.stopAt(position); },
      advance() {
        const pending = pendingRows.get(inner);
        pendingRows.delete(inner);
        if (pending && (inner.stoppedAt == null || inner.parsedPos <= inner.stoppedAt)) { pending(); return null; }
        const tree = inner.advance();
        // Fragment reuse also advances the input, without calling consumeRow.
        // Reconcile that public Line before the next advance closes parents.
        if (!tree) scheduleLazyRow(inner);
        return tree;
      },
    };
  },
  // A composite callback is reached only after all enclosing containers have
  // accepted the line. An eager row parser can consume a lazy continuation
  // before returning control, preserving those parents through missing marks.
  defineNodes: [
    { name: 'LiveTable', composite(cx, line) {
      starts.get(cx)!.continuedAt = cx.lineStart;
      if (!line.text.slice(line.pos).trim()) return false;
      if (cx.lineStart === starts.get(cx)?.delimiter) return true;
      return line.indent >= line.baseIndent + 4 || !startsBlock(line.text.slice(line.pos), cx);
    } },
    { name: 'LiveTableHeader', block: true },
    { name: 'LiveTableDelimiter', block: true },
    { name: 'LiveTableRow', block: true },
    { name: 'LiveTableRowGroup', block: true },
  ],
  parseBlock: [{
    name: 'LiveTableRow', before: 'IndentedCode',
    parse(cx, line) {
      if (cx.parentType().name !== 'LiveTable') return false;
      consumeRow(cx, line);
      return true;
    },
  }, {
    name: 'LiveTable', before: 'SetextHeading',
    parse(cx, line) {
      if (!pipes(line.text.slice(line.pos)).length) return false;
      const next = cx.peekLine();
      if (!separator.test(next)) return false;
      const content = next.replace(/^[>\s]+/, '');
      if (cells(line.text.slice(line.pos)).cells.length !== cells(content).cells.length) return false;
      starts.set(cx, { header: cx.lineStart, delimiter: cx.lineStart + line.text.length + 1, continuedAt: cx.lineStart, line });
      cx.startComposite('LiveTable', line.pos);
      return null;
    },
    endLeaf(cx, line) {
      return pipes(line.text.slice(line.pos)).length > 0 && separator.test(cx.peekLine()) && cells(line.text.slice(line.pos)).cells.length === cells(cx.peekLine().replace(/^[>\s]+/, '')).cells.length;
    },
  }],
};

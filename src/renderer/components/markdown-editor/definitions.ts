import { RangeSet, RangeValue, StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { IterMode, type SyntaxNode, type Tree } from '@lezer/common';

class Definition extends RangeValue {
  readonly startSide = 1; readonly endSide = -1;
  constructor(readonly source: string) { super(); }
}
interface Entry { from: number; to: number; kind: 'definition' | 'mention' | 'heading' }
export interface DocumentHeading { from: number; to: number; level: number; title: string }
const cachedEntries = new WeakMap<Tree, readonly Entry[]>();

/** Cache positions relative to immutable parser subtrees. Reused rows/blocks
 * retain their index, including empty indexes. Parsing progress publishes a
 * new tree and fills distant context without reparsing the source with regex. */
function entries(tree: Tree): readonly Entry[] {
  const known = cachedEntries.get(tree); if (known) return known;
  const found: Entry[] = [];
  tree.iterate({ mode: IterMode.IncludeAnonymous, enter(node) {
    if (node.tree && node.tree !== tree) {
      for (const entry of entries(node.tree)) found.push({ ...entry, from: entry.from + node.from, to: entry.to + node.from });
      return false;
    }
    if (node.name === 'LinkReference' || node.name === 'FootnoteDefinition') {
      found.push({ from: node.from, to: node.to, kind: 'definition' }); return false;
    }
    if (node.name === 'FootnoteReference') found.push({ from: node.from, to: node.to, kind: 'mention' });
    if (/^(ATX|Setext)Heading/.test(node.name)) found.push({ from: node.from, to: node.to, kind: 'heading' });
    if (['FencedCode', 'CodeBlock', 'HTMLBlock', 'Frontmatter', 'InlineCode'].includes(node.name)) return false;
  } });
  cachedEntries.set(tree, found); return found;
}

const normalizeLabel = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
/** Read visible heading text using the same parser, preserving code/escaped
 * punctuation while omitting link destinations and formatting delimiters. */
function headingText(state: EditorState, node: SyntaxNode): string {
  if (/^(HeaderMark|EmphasisMark|CodeMark|StrikethroughMark|LinkMark|LinkTitle|LinkLabel|HTMLTag|QuoteMark)$/.test(node.name)) return '';
  if (node.name === 'URL' && node.parent?.name !== 'Autolink') return '';
  if (node.name === 'Escape') return state.sliceDoc(node.from + 1, node.to);
  let text = '', from = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text += state.sliceDoc(from, child.from) + headingText(state, child); from = child.to;
  }
  return text + state.sliceDoc(from, node.to);
}
function containerContent(source: string, prefix: string) {
  return source.split('\n').map((line, index) => {
    if (!index || !prefix) return line;
    // Container prefixes aren't part of a definition or heading's body.
    return line.slice(Math.min(prefix.length, /^[\s>]*(?:[-+*] |\d+[.)] )?/.exec(line)?.[0].length ?? 0));
  }).join('\n');
}
function definitionSource(state: EditorState, entry: Entry) {
  return containerContent(state.sliceDoc(entry.from, entry.to), state.sliceDoc(state.doc.lineAt(entry.from).from, entry.from));
}
function index(state: EditorState) {
  const tree = syntaxTree(state), indexed = entries(tree);
  const definitions = indexed.filter(entry => entry.kind === 'definition').map(entry => new Definition(definitionSource(state, entry)).range(entry.from, entry.to));
  const byLabel = new Map<string, { from: number; to: number }>();
  for (const item of definitions) {
    const label = /^\[\^([^\]]+)\]:/.exec(item.value.source)?.[1];
    if (label && !byLabel.has(normalizeLabel(label))) byLabel.set(normalizeLabel(label), { from: item.from, to: item.to });
  }
  const footnotes = new Map<string, { number: number; from: number; to: number }>();
  const headings = new Map<string, number>(), slugs = new Map<string, number>();
  const outline: DocumentHeading[] = [];
  for (const entry of indexed) {
    if (entry.kind === 'mention') {
      const label = normalizeLabel(state.sliceDoc(entry.from + 2, entry.to - 1)), target = byLabel.get(label);
      if (target && !footnotes.has(label)) footnotes.set(label, { ...target, number: footnotes.size + 1 });
    } else if (entry.kind === 'heading') {
      const text = state.sliceDoc(entry.from, entry.to).replace(/^#+\s*|\s+#+\s*$|\n[=-]+\s*$/g, '');
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
      let slug = base, count = slugs.get(base) ?? 0;
      while (headings.has(slug)) slug = `${base}-${++count}`;
      slugs.set(base, count); headings.set(slug, entry.from);
      let node = tree.resolveInner(entry.from, 1);
      while (node.parent && !/^(ATX|Setext)Heading/.test(node.name)) node = node.parent;
      const title = containerContent(headingText(state, node), state.sliceDoc(state.doc.lineAt(entry.from).from, entry.from)).trim().replace(/\s+/g, ' ');
      outline.push({ from: entry.from, to: entry.to, level: Number(node.name.at(-1)), title });
    }
  }
  const footnoteNumbers = new Map([...footnotes].map(([label, target]) => [label, target.number]));
  return { tree, footnoteNumbers, ranges: RangeSet.of(definitions), source: definitions.map(entry => entry.value.source).join('\n\n'), footnotes, headings, outline };
}

export const definitions = StateField.define<ReturnType<typeof index>>({
  create: index,
  update(value, tr) {
    if (!tr.docChanged && syntaxTree(tr.state) === value.tree) return value;
    const next = index(tr.state);
    if (next.outline.length === value.outline.length && next.outline.every((heading, i) => {
      const previous = value.outline[i];
      return heading.from === previous.from && heading.to === previous.to && heading.level === previous.level && heading.title === previous.title;
    })) next.outline = value.outline;
    if (next.footnoteNumbers.size === value.footnoteNumbers.size && [...next.footnoteNumbers].every(([label, number]) => value.footnoteNumbers.get(label) === number)) next.footnoteNumbers = value.footnoteNumbers;
    return next;
  },
});

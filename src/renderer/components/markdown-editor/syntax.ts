import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Language } from '@codemirror/language';
import { GFM, MarkdownParser, type BlockContext, type InlineContext, type MarkdownConfig } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { incrementalTables } from './incrementalTables';

// These nodes keep source coordinates. Rendering continues through the shared
// remark/rehype pipeline; no rendered representation is written into the doc.
// Index delimiter runs once per immutable inline parse. A failed opener must
// not scan the rest of a paragraph again for every following dollar sign.
const mathClosers = new WeakMap<InlineContext, Map<number, number>>();
function mathEnd(cx: InlineContext, pos: number): number | undefined {
  let indexed = mathClosers.get(cx);
  if (!indexed) {
    indexed = new Map();
    const runs = [...cx.text.matchAll(/\\[\s\S]|\$+/g)].filter(match => match[0][0] === '$');
    const following = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index], end = following.get(run[0].length);
      if (end !== undefined) indexed.set(cx.offset + run.index, end);
      following.set(run[0].length, cx.offset + run.index + run[0].length);
    }
    mathClosers.set(cx, indexed);
  }
  return indexed.get(pos);
}

const mathBlocks = new WeakMap<BlockContext, { start: number; width: number; closed: boolean }>();
const extras: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }, { name: 'MathBlock', composite(cx) { return !mathBlocks.get(cx)?.closed; } }, { name: 'FootnoteDefinition', block: true }, 'MathMark', 'MathText', 'InlineMath', 'FootnoteReference'],
  parseBlock: [{
    name: 'Frontmatter', before: 'HorizontalRule',
    parse(cx, line) {
      if (cx.lineStart !== 0 || line.text.trim() !== '---') return false;
      const from = cx.lineStart;
      let end = line.text.length;
      while (cx.nextLine()) {
        end = cx.lineStart + line.text.length;
        if (/^(---|\.\.\.)\s*$/.test(line.text)) { cx.nextLine(); break; }
      }
      cx.addElement(cx.elt('Frontmatter', from, end));
      return true;
    },
  }, {
    name: 'MathBlock', before: 'FencedCode',
    parse(cx, line) {
      const text = line.text.slice(line.pos), from = cx.lineStart + line.pos, end = cx.lineStart + line.text.length;
      const fence = /^(\${2,})\s*$/.exec(text);
      if (cx.parentType().name === 'MathBlock') {
        const block = mathBlocks.get(cx)!;
        const opening = cx.lineStart === block.start;
        const closing = !opening && fence && fence[1].length >= block.width;
        cx.addElement(cx.elt(opening || closing ? 'MathMark' : 'MathText', from, end));
        if (closing) block.closed = true;
        cx.nextLine();
        return true;
      }
      if (!fence) return false;
      mathBlocks.set(cx, { start: cx.lineStart, width: fence[1].length, closed: false });
      cx.startComposite('MathBlock', line.pos);
      return null;
    },
  }, {
    name: 'FootnoteDefinition', before: 'LinkReference',
    parse(cx, line) {
      if (!/^\[\^[^\]]+\]:/.test(line.text.slice(line.pos))) return false;
      const from = cx.lineStart + line.pos;
      let end = cx.lineStart + line.text.length;
      while (cx.nextLine()) {
        if (/^( {4}|\t)/.test(line.text.slice(line.basePos)) || !line.text.trim() && /^( {4}|\t)/.test(cx.peekLine())) end = cx.lineStart + line.text.length;
        else break;
      }
      cx.addElement(cx.elt('FootnoteDefinition', from, end));
      return true;
    },
  }],
  parseInline: [{
    name: 'InlineMath', before: 'Escape',
    parse(cx, next, pos) {
      if (next !== 36) return -1;
      const end = mathEnd(cx, pos);
      return end === undefined ? -1 : cx.addElement(cx.elt('InlineMath', pos, end));
    },
  }, {
    name: 'FootnoteReference', before: 'Link',
    parse(cx, next, pos) {
      if (next !== 91) return -1;
      const match = /^\[\^[^\]\s]+\]/.exec(cx.slice(pos, cx.end));
      return match ? cx.addElement(cx.elt('FootnoteReference', pos, pos + match[0].length)) : -1;
    },
  }, {
    // All syntax parsers have already declined this position. Skip ordinary
    // word interiors in one operation instead of calling every parser for
    // each character in a megabyte-long word. Word boundaries still run GFM's
    // autolink/email parser; punctuation always returns to the parser chain.
    name: 'PlainWord',
    parse(cx, next, pos) {
      if (!(next >= 48 && next <= 57 || next >= 65 && next <= 90 || next >= 97 && next <= 122)) return -1;
      const pattern = /[A-Za-z0-9]+/y; pattern.lastIndex = pos - cx.offset;
      const word = pattern.exec(cx.text);
      return word ? pos + word[0].length : -1;
    },
  }],
};

// Configure the base first: markdown() subsequently installs its mixed HTML /
// code wrapper outside the row scheduler. Both share the standard Markdown
// language-data facet, preserving built-in list and formatting commands.
const liveLanguage = new Language(markdownLanguage.data,
  (markdownLanguage.parser as MarkdownParser).configure([GFM, extras, incrementalTables]), [], 'markdown');
export const markdownSyntax = () => markdown({ base: liveLanguage, codeLanguages: languages });

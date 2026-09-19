import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { parser, GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { markdownSyntax } from './syntax';

function parse(source: string) {
  const state = EditorState.create({ doc: source, extensions: markdownSyntax() });
  return ensureSyntaxTree(state, source.length, 1000) ?? syntaxTree(state);
}
describe('editor syntax compatibility', () => {
  it.each(['$x$', '$ x $', '$$ x^2 $$', '$$$x$$$', 'a $x\ny$ b'])('keeps supported inline math %s', source => {
    expect(parse(source).toString()).toContain('InlineMath');
  });
  it.each(['$$\nx\n$$', '> $$\n> x\n> $$', '- $$\n  x\n  $$', '>$$\n> x\n>$$'])('parses math in its actual container %s', source => {
    const marks: string[] = [];
    parse(source).iterate({ enter(node) { if (node.name === 'MathMark') marks.push(source.slice(node.from, node.to)); } });
    expect(marks).toEqual(['$$', '$$']);
  });
  it('stops unfinished math at the container boundary and leaves following text editable', () => {
    expect(parse('> $$\n> x\n\noutside').toString()).toBe('Document(Blockquote(QuoteMark,MathBlock(MathMark,QuoteMark,MathText)),Paragraph)');
  });
  it.each(['ordinary words and a@example.com', 'www.example.com and https://example.com', 'plain**bold** `x$y$` &amp; [link](url)', 'aaaa'.repeat(10000)])('preserves ordinary syntax while skipping word interiors', source => {
    expect(parse(source).toString()).toBe(parser.configure(GFM).parse(source).toString());
  });
});

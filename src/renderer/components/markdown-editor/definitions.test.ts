import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownSyntax } from './syntax';
import { definitions } from './definitions';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { headingAt } from './outlineProjection';

describe('Markdown document context', () => {
  it('indexes all heading levels and nested/setext headings without code or frontmatter lookalikes', () => {
    const doc = '---\n# metadata\n---\n\n# Top\n\n## **Bold** [label](https://example.com) `a_b`\n\n> ### Quoted\n\n- #### Nested\n\n##### Five\n\n###### Six\n\nSetext\n======\n\nSecond\n------\n\n```md\n# Code\n```\n\n    # Indented\n\n<div>\n# HTML\n</div>';
    let state = EditorState.create({ doc, extensions: [markdownSyntax(), definitions] });
    // State creation intentionally has a tiny parser budget. This assertion
    // concerns grammar, not how much background work fits under CPU load.
    ensureSyntaxTree(state, doc.length, 1000);
    state = state.update({}).state;
    const outline = state.field(definitions).outline;
    expect(outline.map(({ title, level }) => [title, level])).toEqual([
      ['Top', 1], ['Bold label a_b', 2], ['Quoted', 3], ['Nested', 4], ['Five', 5], ['Six', 6], ['Setext', 1], ['Second', 2],
    ]);
    for (const heading of outline) expect(state.sliceDoc(heading.from, heading.to)).not.toContain('Code');
  });
  it('keeps duplicate headings distinct and refreshes positions after edits', () => {
    let state = EditorState.create({ doc: '# Same\n\nbody\n\n# Same', extensions: [markdownSyntax(), definitions] });
    const before = state.field(definitions).outline;
    expect(before.map(heading => heading.from)).toEqual([0, 14]);
    expect(headingAt(before, 13)).toBe(0);
    expect(headingAt(before, 14)).toBe(1);
    state = state.update({ changes: { from: 8, insert: 'new\n' } }).state;
    expect(state.field(definitions).outline[1].from).toBe(18);
    state = state.update({ changes: { from: 20, to: 24, insert: 'Renamed' } }).state;
    expect(state.field(definitions).outline[1].title).toBe('Renamed');
  });
  it('retains the outline identity for body edits after the last heading', () => {
    const state = EditorState.create({ doc: '# Heading\n\nbody', extensions: [markdownSyntax(), definitions] });
    const next = state.update({ changes: { from: state.doc.length, insert: ' changed' } }).state;
    expect(next.field(definitions).outline).toBe(state.field(definitions).outline);
  });
  it('uses visible labels and line positions for prefixed headings', () => {
    const doc = '# Top\n\n> Quoted\n> ===\n\n  ## Indented\n\n- ### Nested';
    let state = EditorState.create({ doc, extensions: [markdownSyntax(), definitions] });
    ensureSyntaxTree(state, doc.length, 1000); state = state.update({}).state;
    const headings = state.field(definitions).outline;
    expect(headings.map(h => h.title)).toEqual(['Top', 'Quoted', 'Indented', 'Nested']);
    for (const [index, heading] of headings.entries()) expect(headingAt(headings, state.doc.lineAt(heading.from).to)).toBe(index);
  });
  it('indexes references and multiline footnotes while excluding code examples', () => {
    const source = 'Body [r] and [^n].\n\n[r]: /notes.md\n[^n]: first\n    continuation\n\n```md\n[bad]: /bad\n```\n';
    const state = EditorState.create({ doc: source, extensions: [markdownSyntax(), definitions] });
    expect(state.field(definitions).source).toBe('[r]: /notes.md\n\n[^n]: first\n    continuation');
    expect(syntaxTree(state).toString()).toContain('FootnoteDefinition');
  });
  it('updates an edited definition without losing distant reference context', () => {
    let state = EditorState.create({ doc: '[a]: /one\n\nbody\n\n[b]: /two', extensions: [markdownSyntax(), definitions] });
    state = state.update({ changes: { from: 6, to: 9, insert: 'changed' } }).state;
    expect(state.field(definitions).source).toBe('[a]: /changed\n\n[b]: /two');
    state = state.update({ changes: { from: 0, to: state.doc.line(1).to + 1 } }).state;
    expect(state.field(definitions).source).toBe('[b]: /two');
  });
  it('uses parser semantics for nested definitions, table rows and first-use footnote numbering', () => {
    const source = 'Text [^b] and [^a], again [^b].\n\n> [r]: /nested\n> [^a]: quoted note\n>     continuation\n\n[^b]: another note\n\n| Header |\n| --- |\n[fake]: /inside-table\n';
    const state = EditorState.create({ doc: source, extensions: [markdownSyntax(), definitions] });
    const context = state.field(definitions);
    expect(context.source).toContain('[r]: /nested');
    expect(context.source).toContain('[^a]: quoted note\n    continuation');
    expect(context.source).not.toContain('fake');
    expect([...context.footnoteNumbers]).toEqual([['b', 1], ['a', 2]]);
  });
  it('updates context when a syntax boundary turns definitions into code', () => {
    let state = EditorState.create({ doc: '[r]: /target\n\nText [^a]\n\n[^a]: note', extensions: [markdownSyntax(), definitions] });
    state = state.update({ changes: { from: 0, insert: '```md\n' } }).state;
    expect(state.field(definitions).source).toBe('');
    expect(state.field(definitions).footnotes.size).toBe(0);
  });

});

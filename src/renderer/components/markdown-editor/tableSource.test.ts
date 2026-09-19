import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdownSyntax } from './syntax';
import { pasteTableCells, replaceCell, tableAction, tableAt, tableFromNode } from './tableSource';

const document = (doc: string) => EditorState.create({ doc, extensions: markdownSyntax() });

describe('Markdown table source operations', () => {
  it('reads only requested rows from a fully parsed large table', () => {
    const state = document('> | A | B |\n> |---|---|\n' + '> | x | y |\n'.repeat(5000));
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)!;
    const node = tree.topNode.getChild('Blockquote')!.getChild('LiveTable')!;
    const slices = vi.spyOn(state, 'sliceDoc');
    const table = tableFromNode(state, node)!;
    expect(table.rows.length).toBe(5001);
    expect(table.rows.at(5000)?.cells.map(cell => cell.text)).toEqual(['x', 'y']);
    expect(slices.mock.calls.length).toBeLessThan(50);
    slices.mockRestore();
  });
  it('locates empty cells and escaped pipes without splitting inline code', () => {
    const state = document('| A | B | C |\n| --- | --- | --- |\n| a\\|b |  | `x\\|y` |');
    const table = tableAt(state, 0)!;
    expect(table.rows.at(1)!.cells.map(cell => cell.text)).toEqual(['a\\|b', '', '`x\\|y`']);
    const next = state.update({ changes: replaceCell(table, 1, 1, '中文|x') }).state;
    expect(next.doc.toString()).toBe('| A | B | C |\n| --- | --- | --- |\n| a\\|b | 中文\\|x | `x\\|y` |');
  });
  it('handles optional outer pipes and materializes missing cells', () => {
    const state = document('A | B\n--- | ---\nx');
    const table = tableAt(state, 0)!;
    expect(table.columns).toBe(2);
    const next = state.update({ changes: replaceCell(table, 1, 1, 'y') }).state;
    expect(tableAt(next, 0)!.rows.at(1)!.cells.map(cell => cell.text)).toEqual(['x', 'y']);
  });
  it('retains quote prefixes during row insertion and alignment', () => {
    let state = document('> | A | B |\n> | --- | --- |\n> | x | y |');
    let table = tableAt(state, 2)!;
    state = state.update({ changes: tableAction(state, table, 'row-after', 1, 0) }).state;
    expect(state.doc.toString().endsWith('\n> |  |  |')).toBe(true);
    table = tableAt(state, 2)!;
    state = state.update({ changes: tableAction(state, table, 'align-center', 1, 1) }).state;
    expect(state.doc.toString()).toContain('> | --- | :---: |');
  });
  it('preserves extra cells in structural column edits', () => {
    const state = document('| A | B |\n| --- | --- |\n| x | y | extra |');
    const next = state.update({ changes: tableAction(state, tableAt(state, 0)!, 'column-after', 1, 0) }).state;
    expect(tableAt(next, 0)!.rows.at(1)!.cells.map(cell => cell.text)).toEqual(['x', '', 'y', 'extra']);
  });
  it('pastes a rectangle as one source change while extending rows and columns', () => {
    const state = document('before\n\n| A | B |\n| --- | --- |\n| x | y |\n\nafter');
    const table = tableAt(state, 8)!;
    const next = state.update({ changes: pasteTableCells(state, table, 1, 1, 'one\ttwo\n三\t四') }).state;
    expect(next.doc.toString()).toBe('before\n\n| A | B |  |\n| --- | --- | --- |\n| x | one | two |\n|  | 三 | 四 |\n\nafter');
  });
  it.each(['- ', '1. ', '> - '])('grows a header-only nested table using its continuation prefix: %s', prefix => {
    const continuation = prefix.replace(/(?:[-+*]|\d+[.)]) /, marker => ' '.repeat(marker.length));
    const source = `${prefix}| A | B |\n${continuation}| --- | --- |`;
    const state = document(source), table = tableAt(state, prefix.length)!;
    const next = state.update({ changes: tableAction(state, table, 'row-after', 0, 0) }).state;
    expect(next.doc.toString()).toBe(`${source}\n${continuation}|  |  |`);
    expect(tableAt(next, prefix.length)?.rows).toHaveLength(2);
  });
  it.each(['a\\', 'a\\\\', 'a\\\\\\', '`x\\`'])('preserves an adjacent delimiter after editing %s', text => {
    const state = document('| H | B |\n| --- | --- |\n| x| y |');
    const next = state.update({ changes: replaceCell(tableAt(state, 0)!, 1, 0, text) }).state;
    expect(tableAt(next, 0)!.rows.at(1)!.cells.map(cell => cell.text)).toEqual([text, 'y']);
  });
});

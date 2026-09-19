import { parser, GFM } from '@lezer/markdown';
import { Tree, TreeFragment } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { incrementalTables } from './incrementalTables';

const stock = parser.configure(GFM), incremental = parser.configure([GFM, incrementalTables]);
const shape = (tree: Tree) => {
  const nodes: string[] = [];
  tree.iterate({ enter(node) { if (node.name !== 'LiveTableRowGroup') nodes.push(`${node.name.replace(/^LiveTable/, 'Table')}:${node.from}:${node.to}`); } });
  return nodes.join('\n');
};

describe('incremental GFM row parsing', () => {
  it('yields between bounded lazy row groups and honors a partial-parser stop boundary', () => {
    const source = '> | A | B |\n> |---|---|\n' + '| x | y |\n'.repeat(1000);
    const parse = incremental.startParse(source);
    let steps = 0;
    while (parse.parsedPos < 150) { expect(parse.advance()).toBeNull(); steps++; }
    expect(steps).toBeGreaterThan(2);
    const boundary = parse.parsedPos;
    parse.stopAt(boundary);
    let tree; while (!(tree = parse.advance())) { /* finish at the requested boundary */ }
    expect(tree.length).toBeLessThan(source.length / 2);
    expect(shape(incremental.parse(source))).toBe(shape(stock.parse(source)));
    expect(shape(incremental.parse(source, TreeFragment.addTree(tree, [], true)))).toBe(shape(stock.parse(source)));
  });
  it.each(['> ', '- ', '> - '])('keeps lazy containers after fragment reuse near a distant edited row: %j', prefix => {
    const continuation = prefix.replace('- ', '  ');
    const source = `${prefix}| A | B |\n${continuation}|---|---|\n` + '| x | y |\n'.repeat(1000) + '\nend';
    const before = incremental.parse(source), from = source.lastIndexOf('x');
    const updated = source.slice(0, from) + 'edit' + source.slice(from + 1);
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(before), [{ fromA: from, toA: from + 1, fromB: from, toB: from + 4 }]);
    expect(shape(incremental.parse(updated, fragments))).toBe(shape(stock.parse(updated)));
  });
  it.each([
    '| a | b |\n| --- | --- |\n| c | d |',
    'a | b\n--- | ---\nx | y\n\nnext',
    '| a | b |\n| --- | --- |\n| c |\n| extra | cells | kept |\n',
    '| a\\|x | `b\\|c` |\n| --- | --- |\n| | |',
    '> | a | b |\n> | --- | --- |\n> | c | d |\n>\n> after',
    '- | a | b |\n  | --- | --- |\n  | c | d |\n\nnext',
    'before\na | b\n--- | ---\nx | y\n\nafter',
    '| a | b |\n| --- | --- |\nplain text\n# heading\nnext',
    '| a | b |\n| --- | --- |\n- list item\n\nnext',
    '| a | b |\n| --- | --- |\n```js\ncode\n```',
    '| a | b |\n| --- | --- |\n<div>html</div>\n',
    '| a | b |\n| --- | --- |\n> quote\n',
    '| a | b |\n| --- | --- |\n    indented | text\n',
    '| a | b |\n| --- | --- |\n| c | d |\n\n| second | table |\n| --- | --- |\n| x | y |',
  ])('matches upstream GFM source coordinates: %s', source => {
    expect(shape(incremental.parse(source))).toBe(shape(stock.parse(source)));
  });

  it.each(['', '> ', '  '])('reuses unaffected row trees when one cell changes inside %j', prefix => {
    const source = `${prefix}| a | b |\n${prefix}| --- | --- |\n` + `${prefix}| c | d |\n`.repeat(1000);
    const first = incremental.parse(source);
    const from = source.indexOf('c');
    const changes = [{ fromA: from, toA: from + 1, fromB: from, toB: from + 4 }];
    const updated = source.slice(0, from) + 'cell' + source.slice(from + 1);
    const second = incremental.parse(updated, TreeFragment.applyChanges(TreeFragment.addTree(first), changes));
    expect(shape(second)).toBe(shape(stock.parse(updated)));
    const previous = new Set<Tree>();
    const collect = (tree: Tree, visit: (value: Tree) => void) => { visit(tree); for (const child of tree.children) if (child instanceof Tree) collect(child, visit); };
    collect(first, node => previous.add(node));
    let reusedCharacters = 0;
    collect(second, node => { if (previous.has(node) && node.type.name === 'LiveTableRowGroup') reusedCharacters += node.length; });
    expect(reusedCharacters).toBeGreaterThan(source.length / 2);
  });
  it('keeps container lifetimes across lazy continuation and incremental edits', () => {
    for (const prefix of ['> ', '- ', '> - ', '1. ', '> 1. ']) {
      const continuation = prefix.replace(/(?:[-+*]|\d+[.)]) /, value => ' '.repeat(value.length));
      for (const lazy of ['plain | text', '    indented | cell', '| c | d |', '2. text', '> partial | quote']) {
        const source = `${prefix}| a | b |\n${continuation}| --- | --- |\n${lazy}\n${continuation}| end | row |\n\nafter`;
        const tree = incremental.parse(source);
        expect(shape(tree), source).toBe(shape(stock.parse(source)));
        const from = source.indexOf('end'), updated = source.slice(0, from) + 'new' + source.slice(from + 3);
        const next = incremental.parse(updated, TreeFragment.applyChanges(TreeFragment.addTree(tree), [{ fromA: from, toA: from + 3, fromB: from, toB: from + 3 }]));
        expect(shape(next), updated).toBe(shape(stock.parse(updated)));
      }
    }
  });
  it('matches upstream across generated cell and interrupting-block combinations', () => {
    const cells = ['plain', '', 'a\\|b', '`x\\|y`', '**bold**', '中文😀', '[link](url)', 'x\\\\|y'];
    const prefixes = ['', '> ', '  '], endings = ['\n', '\n\nend', '\n<SCRIPT>\ncode\n</SCRIPT>', '\n<!-- comment -->', '\n***', '\n1. item', '\n    code'];
    for (let index = 0; index < 180; index++) {
      const prefix = prefixes[index % prefixes.length];
      const source = [ '| a | b |', '| :--- | ---: |', `| ${cells[index % cells.length]} | ${cells[(index * 3 + 1) % cells.length]} |`].map(line => prefix + line).join('\n') + endings[index % endings.length];
      expect(shape(incremental.parse(source)), source).toBe(shape(stock.parse(source)));
    }
  });

});

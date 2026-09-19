import { describe, expect, it } from 'vitest';
import { combineSourceLines, compareSourceLines, comparisonBlocks, unresolvedRows, type DiffSide } from './lineDiff';

describe('Markdown line conflict choices', () => {
  it.each([false, true])('reconstructs either exact side with simplified=%s', async simplified => {
    for (const [local, disk] of [
      ['', '\uFEFFnew\r\n'], ['a\r\nb\n', 'a\nnew\r\nx'], ['same\nsame\n', 'same\n'],
      ['a\n\nb\n', '\n中文\n'], ['\uFEFF', ''], ['a', 'a\n'], ['\n', ''],
    ]) {
      const comparison = await compareSourceLines(local, disk, simplified);
      for (const [side, expected] of [['local', local], ['disk', disk]] as const) {
        const choices = new Map(comparison.rows.filter(row => row.changed).map(row => [row.id, side]));
        expect(combineSourceLines(comparison, choices)).toBe(expected);
      }
    }
  });
  it('allows different choices within one display block', async () => {
    const comparison = await compareSourceLines('a\nlocal1\nlocal2\nz', 'a\ndisk1\ndisk2\nz');
    const changed = comparison.rows.filter(row => row.changed);
    expect(comparisonBlocks(comparison)).toHaveLength(1);
    expect(changed).toHaveLength(2);
    const choices = new Map<number, DiffSide>([[changed[0].id, 'local']]);
    expect(unresolvedRows(comparison, choices)).toBe(1);
    expect(() => combineSourceLines(comparison, choices)).toThrow('Unresolved');
    choices.set(changed[1].id, 'disk');
    expect(combineSourceLines(comparison, choices)).toBe('a\nlocal1\ndisk2\nz');
  });
  it('selects the empty side to omit an added line, preserving a real blank line', async () => {
    const comparison = await compareSourceLines('a\n\nb', 'a\nadded\n\nb');
    const choices = new Map<number, DiffSide>();
    comparison.rows.filter(row => row.changed).forEach(row => choices.set(row.id, 'local'));
    expect(combineSourceLines(comparison, choices)).toBe('a\n\nb');
  });
  it.each([false, true])('preserves chosen blank lines at new CR/LF joins with simplified=%s', async simplified => {
    for (const [local, disk, expected] of [
      ['a\rb', 'a\n\nb', 'a\r\n\nb'],
      // Connecting a selected EOF line inherits CR from the preceding line.
      ['p\ra', 'p\nx\n\nb', 'p\ra\r\n\nb'],
    ]) {
      const comparison = await compareSourceLines(local, disk, simplified);
      const choices = new Map<number, DiffSide>(comparison.rows.filter(row => row.changed)
        .map(row => [row.id, row.local ? 'local' : 'disk']));
      expect(combineSourceLines(comparison, choices)).toBe(expected);
    }
  });
  it('round-trips either original across generated repeated lines, BOM and mixed endings', async () => {
    let seed = 731;
    const pick = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
    const make = () => (pick(4) === 0 ? '\uFEFF' : '') + Array.from({ length: pick(18) }, () => ['same', '', '中文😀', 'a', 'b'][pick(5)] + ['\n', '\r', '\r\n'][pick(3)]).join('').replace(pick(2) ? /(?:\r\n|[\r\n])$/ : /NEVER$/, '');
    for (let i = 0; i < 120; i++) {
      const local = make(), disk = make(), result = await compareSourceLines(local, disk, i % 3 === 0);
      for (const side of ['local', 'disk'] as const) expect(combineSourceLines(result, new Map(result.rows.filter(row => row.changed).map(row => [row.id, side])))).toBe(side === 'local' ? local : disk);
    }
  });

});

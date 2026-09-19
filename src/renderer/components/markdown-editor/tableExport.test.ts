import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { editorTableSnapshot } from './tableExport';

describe('editor table export', () => {
  it('selects a nested table by source position with document references', () => {
    const source = '| Earlier |\n| --- |\n| ignored |\n\n> | Chosen |\n> | --- |\n> | [label][ref] |\n\n[ref]: https://example.com';
    const state = EditorState.create({ doc: source });
    const snapshot = editorTableSnapshot(state, source.indexOf('| Chosen'));
    expect(snapshot.rows).toEqual([['Chosen'], ['label']]);
    expect(snapshot.html).toContain('https://example.com');
    expect(snapshot.html).not.toContain('Earlier');
  });
  it('exports the current document beyond the virtual row window and preserves source', () => {
    const source = '| Name | Value |\n| --- | --- |\n' + Array.from({ length: 90 }, (_, i) => `| row${i} | **value${i}** |`).join('\n');
    const initial = EditorState.create({ doc: source, extensions: [] });
    const offset = source.indexOf('value89');
    const state = initial.update({ changes: { from: offset, to: offset + 7, insert: 'changed' } }).state;
    const snapshot = editorTableSnapshot(state, 0);
    expect(snapshot.rows).toHaveLength(91);
    expect(snapshot.rows[90]).toEqual(['row89', 'changed']);
    expect(snapshot.html).toContain('<strong>changed</strong>');
    expect(state.doc.toString()).toBe(source.replace('value89', 'changed'));
  });
});

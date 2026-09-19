import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { decodeSource, encodeSource, sourceFormatExtensions } from './sourceFormat';

function document(raw: string) {
  return EditorState.create({ doc: decodeSource(raw).text, extensions: [history(), sourceFormatExtensions(raw)] });
}

describe('Markdown source format', () => {
  it.each(['', '\uFEFF', '# 标题\r\n\r\ntext  \r\n', 'a\r\nb\nc\r', 'tail', '\n\n'])('round trips exact source %j', raw => {
    expect(encodeSource(document(raw))).toBe(raw);
  });
  it('preserves untouched separators and chooses the adjacent separator on insertion', () => {
    const state = document('\uFEFFa\r\nb\nc\r');
    const next = state.update({ changes: { from: 1, insert: '\nx' } }).state;
    expect(encodeSource(next)).toBe('\uFEFFa\r\nx\r\nb\nc\r');
  });
  it('deletes separators without leaving zero-width mapping records', () => {
    let state = document('a\r\nb\nc\r');
    state = state.update({ changes: { from: 1, to: 4, insert: 'new' } }).state;
    expect(encodeSource(state)).toBe('anewc\r');
  });
  it('restores the exact format through undo and redo', () => {
    const raw = '\uFEFFa\r\nb\nc\r';
    let state = document(raw);
    const dispatch = (transaction: { state: EditorState }) => { state = transaction.state; };
    state = state.update({ changes: { from: 1, to: 4, insert: '\nx\ny' }, annotations: isolateHistory.of('full') }).state;
    const edited = encodeSource(state);
    expect(undo({ state, dispatch })).toBe(true);
    expect(encodeSource(state)).toBe(raw);
    expect(redo({ state, dispatch })).toBe(true);
    expect(encodeSource(state)).toBe(edited);
  });
  it('replaces separators without retaining overlapping format ranges', () => {
    for (const raw of ['a\nb\nc', 'a\r\nb', '\uFEFFa\r\nb\nc\r']) {
      const state = document(raw).update({ changes: { from: 1, to: 2, insert: '\n' } }).state;
      expect(encodeSource(state)).toBe(raw);
    }
  });
  it('keeps two logical newlines when a deletion brings CR and LF together', () => {
    let state = document('a\rb\nc');
    const dispatch = (tr: { state: EditorState }) => { state = tr.state; };
    state = state.update({ changes: { from: 2, to: 3 }, annotations: isolateHistory.of('full') }).state;
    expect(encodeSource(state)).toBe('a\r\n\nc');
    expect(decodeSource(encodeSource(state)).text).toBe('a\n\nc');
    undo({ state, dispatch });
    expect(encodeSource(state)).toBe('a\rb\nc');
    redo({ state, dispatch });
    expect(decodeSource(encodeSource(state)).text).toBe('a\n\nc');
  });
  it.each([1729, 719])('keeps one format range per newline across generated replacements and history (seed %i)', initialSeed => {
    let state = document('\uFEFFa\r\nb\nc\rend'), seed = initialSeed;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const dispatch = (tr: { state: EditorState }) => { state = tr.state; };
    for (let step = 0; step < 2500; step++) {
      const before = encodeSource(state), from = random(state.doc.length + 1), to = from + random(state.doc.length - from + 1);
      const tr = state.update({ changes: { from, to, insert: ['\n', 'x\ny', '', '\n\n', '中文'][random(5)] }, annotations: isolateHistory.of('full') });
      state = tr.state;
      const after = encodeSource(state);
      expect(decodeSource(after).text).toBe(state.doc.toString());
      if (tr.docChanged && undo({ state, dispatch })) {
        expect(encodeSource(state)).toBe(before);
        expect(redo({ state, dispatch })).toBe(true);
        expect(encodeSource(state)).toBe(after);
      }
    }
  });
});

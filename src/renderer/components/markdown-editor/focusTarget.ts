import { StateEffect, StateField, EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { FilePreviewFocusTarget } from '@/types/filePreview';
import { revealBlock } from './livePreview';

export const focusSource = StateEffect.define<FilePreviewFocusTarget>();
export function focusRanges(state: EditorState, target: FilePreviewFocusTarget) {
  const line = state.doc.line(Math.max(1, Math.min(target.lineNumber, state.doc.lines)));
  const supplied = target.highlights?.length ? target.highlights : [];
  const matches = [...supplied];
  if (!matches.length && target.query) {
    const text = line.text.toLowerCase(), query = target.query.toLowerCase();
    for (let offset = 0, at; (at = text.indexOf(query, offset)) >= 0;) { matches.push([at, at + query.length]); offset = at + query.length; }
  }
  return { line, ranges: matches.map(([a, b]) => ({ from: line.from + Math.max(0, Math.min(line.length, a)), to: line.from + Math.max(0, Math.min(line.length, b)) })).filter(range => range.to > range.from) };
}
export const focusDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(focusSource)) {
      const { line, ranges } = focusRanges(tr.state, effect.value);
      return Decoration.set([Decoration.line({ class: 'md-focus-line' }).range(line.from), ...ranges.map(range => Decoration.mark({ class: 'md-focus-match' }).range(range.from, range.to))], true);
    }
    return value.map(tr.changes);
  },
  provide: field => EditorView.decorations.from(field),
});
// Search commands already carry a source selection. Extend that transaction so
// its hit becomes editable before CM tries to scroll through a hidden widget.
export const revealSearch = EditorState.transactionExtender.of(tr => {
  if (!tr.isUserEvent('select.search')) return null;
  const { from, to } = tr.newSelection.main;
  return { effects: revealBlock.of({ from, to: Math.max(from + 1, to) }) };
});

import { EditorSelection, Facet, type EditorState } from '@codemirror/state';
import type { Command, EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { definitions } from './definitions';

export function wrapSelection(marker: string, closing = marker): Command {
  return view => {
    if (view.state.readOnly) return false;
    view.dispatch(view.state.changeByRange(range => {
      const selected = view.state.sliceDoc(range.from, range.to);
      const inside = selected.startsWith(marker) && selected.endsWith(closing) && selected.length >= marker.length + closing.length;
      const adjacent = view.state.sliceDoc(Math.max(0, range.from - marker.length), range.from) === marker &&
        view.state.sliceDoc(range.to, range.to + closing.length) === closing;
      if (inside) return { changes: { from: range.from, to: range.to, insert: selected.slice(marker.length, -closing.length) },
        range: EditorSelection.range(range.from, range.to - marker.length - closing.length) };
      if (adjacent) return { changes: [{ from: range.from - marker.length, to: range.from }, { from: range.to, to: range.to + closing.length }],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length) };
      return { changes: { from: range.from, to: range.to, insert: marker + selected + closing },
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length) };
    }), { userEvent: 'input.format' });
    view.focus();
    return true;
  };
}

export function selectionLines(state: EditorState) {
  const { from, to } = state.selection.main;
  return { startLine: state.doc.lineAt(from).number, endLine: state.doc.lineAt(Math.max(from, to - 1)).number };
}

export interface LinkEdit { from: number; to: number; url: string; label: string; destinationOnly: boolean }
export const editLink = Facet.define<() => void, () => void>({ combine: values => values[0] ?? (() => {}) });
export function linkEditAtSelection(state: EditorState): LinkEdit {
  const selection = state.selection.main;
  let node = syntaxTree(state).resolveInner(selection.from, 1);
  while (node.parent && node.name !== 'Link') node = node.parent;
  if (node.name === 'Link') {
    const url = node.getChild('URL');
    if (url) return { from: url.from, to: url.to, url: state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''), label: '', destinationOnly: true };
    const labelNode = node.getChild('LinkLabel');
    const source = state.sliceDoc(node.from, node.to);
    const label = (labelNode ? state.sliceDoc(labelNode.from + 1, labelNode.to - 1) : '') || /^\[([^\]]+)\]/.exec(source)?.[1];
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
    let target: LinkEdit | undefined;
    if (label) state.field(definitions, false)?.ranges.between(0, state.doc.length, (from, _to, definition) => {
      if (target || normalize(/^\[([^\]]+)\]:/.exec(definition.source)?.[1] ?? '') !== normalize(label)) return;
      let reference = syntaxTree(state).resolveInner(from + 1, 1);
      while (reference.parent && reference.name !== 'LinkReference') reference = reference.parent;
      const url = reference.getChild('URL');
      if (url) target = { from: url.from, to: url.to, url: state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''), label: '', destinationOnly: true };
    });
    if (target) return target;
  }
  return { from: selection.from, to: selection.to, url: '', label: state.sliceDoc(selection.from, selection.to), destinationOnly: false };
}
export function applyLink(view: EditorView, target: LinkEdit, url: string) {
  if (view.state.readOnly) return;
  const destination = `<${url.trim().replace(/[<>\s]/g, char => encodeURIComponent(char))}>`;
  const label = target.label || url.trim().replace(/[\\[\]]/g, '\\$&');
  view.dispatch({ changes: { from: target.from, to: target.to, insert: target.destinationOnly ? destination : `[${label}](${destination})` }, userEvent: 'input.link', annotations: isolateHistory.of('full') });
  view.focus();
}

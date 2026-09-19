import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composing, focusedField, livePreview, sourceBlock } from './livePreview';

import { markdownSyntax } from './syntax';
import { definitions } from './definitions';
import { ensureSyntaxTree } from '@codemirror/language';

// jsdom cannot reproduce browser line wrapping. Exercise the scheduling boundary
// with a real CM view, leaving actual geometry convergence to the browser smoke.
function fixture() {
  type Request = NonNullable<Parameters<EditorView['requestMeasure']>[0]>;
  const requests: Request[] = [];
  vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(request => {
    if (request) requests.push(request);
  });
  const view = new EditorView({ state: EditorState.create({
    doc: 'x'.repeat(12000), extensions: [sourceBlock, focusedField, livePreview()],
  }) });
  document.body.append(view.dom);
  vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 800));
  let reading = false;
  const coords = vi.spyOn(view, 'posAtCoords').mockImplementation(point => {
    expect(reading).toBe(true);
    // A geometry read may synchronously notify the plugin again. It must still
    // belong to the pending request rather than enqueue another microtask read.
    view.scrollDOM.dispatchEvent(new Event('scroll'));
    return point.y < 400 ? 5000 : 8000;
  });
  const dispatch = vi.spyOn(view, 'dispatch');
  const read = () => {
    const request = requests.shift()!;
    reading = true;
    const region = request.read(view);
    reading = false;
    return () => request.write?.(region, view);
  };
  return { view, requests, coords, dispatch, read };
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('live projection measurement lifecycle', () => {
  it('reads geometry only in CM measure phase and coalesces reentrant requests until commit', async () => {
    const { view, requests, coords, dispatch, read } = fixture();
    try {
      await Promise.resolve();
      expect(coords).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      const write = read();
      expect(coords).toHaveBeenCalledTimes(2);
      expect(requests).toHaveLength(0);
      write();
      expect(dispatch).not.toHaveBeenCalled();
      view.scrollDOM.dispatchEvent(new Event('scroll'));
      expect(requests).toHaveLength(0);
      await Promise.resolve();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(coords).toHaveBeenCalledTimes(2);
    } finally { view.destroy(); }
  });

  it.each(['edit', 'destroy'] as const)('does not commit coordinates after %s invalidates their document', async invalidation => {
    const { view, requests, dispatch, read } = fixture();
    const write = read();
    write();
    if (invalidation === 'edit') view.dispatch({ changes: { from: 0, insert: 'new' } });
    else view.destroy();
    dispatch.mockClear();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(invalidation === 'edit' ? 1 : 0);
    if (invalidation === 'edit') view.destroy();
  });
});

function projectedState(doc: string) {
  let state = EditorState.create({ doc, extensions: [markdownSyntax(), definitions, sourceBlock, focusedField, livePreview()] });
  ensureSyntaxTree(state, doc.length, 1000);
  state = state.update({}).state;
  return state;
}
function projections(state: EditorState) {
  const found: { from: number; to: number; kind: string; height: number; breaks: number; block: boolean }[] = [];
  for (const set of state.facet(EditorView.decorations)) {
    if (typeof set === 'function') continue;
    (set as DecorationSet).between(0, state.doc.length, (from, to, decoration) => {
      const widget = decoration.spec.widget;
      if (widget?.projection) found.push({ from, to, kind: widget.projection.kind, height: widget.estimatedHeight, breaks: widget.lineBreaks, block: !!decoration.spec.block });
    });
  }
  return found;
}
describe('document layout projections', () => {
  it('keeps every parsed block independent of the initial viewport and estimates large tables from rows', () => {
    const table = '| A | B |\n| --- | --- |\n' + '| value | text |\n'.repeat(500);
    const doc = table + '\n' + 'paragraph\n\n'.repeat(500) + '![](image.png)\n\n' + table;
    const state = projectedState(doc);
    const blocks = projections(state).filter(p => p.block);
    expect(blocks.map(p => p.kind)).toEqual(['Table', 'Image', 'Table']);
    expect(blocks[0].height).toBeGreaterThan(17_000);
    expect(blocks[2].from).toBeGreaterThan(4000);
  });
  it('maps layout during composition and refreshes after composition ends', () => {
    let state = projectedState('text\n\n![image](image.png)');
    const before = projections(state);
    state = state.update({ effects: composing.of(true) }).state;
    state = state.update({ changes: { from: 0, insert: 'IME' } }).state;
    expect(projections(state).map(p => p.from)).toEqual(before.map(p => p.from + 3));
    state = state.update({ effects: composing.of(false) }).state;
    expect(projections(state).map(p => p.kind)).toEqual(['Image']);
  });
  it.each([['<br>', 1], ['<br class="test">', 1], ['<span>one<br title="x > y">two<br/>three</span>', 2], ['<span title="<br>">text</span>', 0], ['<span title="multi\nline">text</span>', 0], ['<span>one\ntwo</span>', 1]] as const)('counts rendered breaks in %s using parser tags', (html, breaks) => {
    const state = projectedState('before ' + html + ' after');
    expect(projections(state).find(p => p.kind === 'InlineHTML')?.breaks).toBe(breaks);
  });
  it('reports inline images and HTML as height-relevant widgets', () => {
    const state = projectedState('[![badge](badge.png)](https://example.com)\n\ntext <kbd>key</kbd> after');
    const inline = projections(state).filter(p => !p.block);
    expect(inline.map(p => p.kind)).toEqual(['Image', 'InlineHTML']);
    expect(inline.every(p => p.height >= 5)).toBe(true);
  });
});

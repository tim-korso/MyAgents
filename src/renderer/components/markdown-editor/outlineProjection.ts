import { forceParsing, syntaxTreeAvailable } from '@codemirror/language';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { definitions, type DocumentHeading } from './definitions';

export interface OutlineProjection { view: EditorView; headings: readonly DocumentHeading[]; active: number; complete: boolean }

export function headingAt(headings: readonly DocumentHeading[], position: number): number {
  let low = 0, high = headings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (headings[mid].from <= position) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

/** View lifetime owns global parse work and scroll measurements. React gets
 * only headings/current section; scrolling never reparses or scans the DOM. */
export function documentOutline(publish: (value: OutlineProjection | null, view: EditorView) => void) {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private alive = true;
    private previous: OutlineProjection | undefined;
    constructor(readonly view: EditorView) {
      view.scrollDOM.addEventListener('scroll', this.measure, { passive: true });
      this.measure(); this.scheduleParse();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.geometryChanged || update.viewportChanged || update.startState.field(definitions) !== update.state.field(definitions)) this.measure();
      if (update.docChanged) this.scheduleParse();
    }
    private scheduleParse() {
      clearTimeout(this.timer);
      if (syntaxTreeAvailable(this.view.state)) return;
      this.timer = setTimeout(() => {
        if (!this.alive) return;
        // CM's normal parser may stop beyond the viewport. Give the same
        // parser bounded slices until distant headings are also indexed.
        forceParsing(this.view, this.view.state.doc.length, 15);
        this.measure(); this.scheduleParse();
      }, 80);
    }
    private measure = () => {
      this.view.requestMeasure({ key: this, read: view => {
        const headings = view.state.field(definitions).outline;
        const height = Math.max(0, view.scrollDOM.getBoundingClientRect().top + 32 - view.documentTop);
        // A heading inside a quote/list or indented ATX starts after its
        // physical line's prefix. Include that line when finding its section.
        const position = view.state.doc.lineAt(view.lineBlockAtHeight(height).from).to;
        const atEnd = view.scrollDOM.scrollTop > 0 && view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight - view.scrollDOM.scrollTop < 2;
        return { view, headings, active: atEnd ? Math.max(0, headings.length - 1) : headingAt(headings, position), complete: syntaxTreeAvailable(view.state) };
      }, write: value => {
        if (!this.alive) return;
        if (value.headings !== this.previous?.headings || value.active !== this.previous.active || value.complete !== this.previous.complete) {
          this.previous = value; publish(value, this.view);
        }
      } });
    };
    destroy() {
      this.alive = false; clearTimeout(this.timer);
      this.view.scrollDOM.removeEventListener('scroll', this.measure);
      publish(null, this.view);
    }
  });
}

import { Facet, StateEffect, StateField } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { MarkdownImageSource, WorkspaceFileService } from '@/hooks/useWorkspaceFileService';

export interface ImageInsertionRange { from: number; to: number; prefix?: string; suffix?: string }
interface ImageAnchor extends ImageInsertionRange { valid: boolean }
class ImportPlaceholder extends WidgetType {
  eq() { return true; }
  toDOM(view: EditorView) {
    const span = document.createElement('span'); span.className = 'md-image-import-anchor';
    span.setAttribute('role', 'status'); span.setAttribute('aria-label', view.state.phrase('Importing image'));
    span.textContent = '…'; return span;
  }
}
const addAnchor = StateEffect.define<{ id: number; anchor: ImageAnchor }>();
const removeAnchor = StateEffect.define<number>();
const clearAnchors = StateEffect.define<null>();
export const imageAnchors = StateField.define<ReadonlyMap<number, ImageAnchor>>({
  create: () => new Map(),
  update(value, tr) {
    const next = new Map<number, ImageAnchor>();
    for (const [id, anchor] of value) {
      let valid = anchor.valid;
      tr.changes.iterChangedRanges((from, to) => { if (to > from && from <= anchor.to && to >= anchor.from) valid = false; });
      next.set(id, { ...anchor, from: tr.changes.mapPos(anchor.from, 1), to: tr.changes.mapPos(anchor.to, 1), valid });
    }
    for (const effect of tr.effects) {
      if (effect.is(addAnchor)) next.set(effect.value.id, effect.value.anchor);
      if (effect.is(removeAnchor)) next.delete(effect.value);
      if (effect.is(clearAnchors)) next.clear();
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field, anchors => Decoration.set([...anchors.values()].filter(anchor => anchor.valid).map(anchor => Decoration.widget({ widget: new ImportPlaceholder(), side: 1 }).range(anchor.from)), true)),
});
export type ImageInput = File | { path: string };
export interface ImageImportFailure { input: ImageInput; error: string }
type ImportImages = (inputs: ImageInput[], range?: ImageInsertionRange) => void;
export const importImage = Facet.define<ImportImages, ImportImages>({ combine: values => values[0] });

export function importFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown|ipc|disconnected|channel|timed? ?out|transport/i.test(message) ? `unknown: ${message}` : message;
}

function fileSource(file: File): Promise<MarkdownImageSource> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Cannot read clipboard image'));
    reader.onload = () => resolve({ kind: 'base64', name: file.name || 'image.png', base64: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}

/** Local to one mounted document. Jobs serialize, anchors map through edits,
 * and a rename/close invalidates insertion authority without deleting assets. */
export class ImageImportQueue {
  private nextId = 0;
  private generation = 0;
  private invalidationReason = 'targetChanged';
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly context: () => { view: EditorView; path: string; service: WorkspaceFileService },
    private readonly report: (error: string, completed: string[], remaining?: ImageInput[], failures?: ImageImportFailure[]) => void,
    private readonly pending: (busy: boolean) => void) {}
  invalidate(reason = 'targetChanged') { this.generation++; this.invalidationReason = reason; this.context().view.dispatch({ effects: clearAnchors.of(null) }); }
  settled() { return this.tail; }
  enqueue(inputs: ImageInput[], range?: ImageInsertionRange) {
    if (!inputs.length) return;
    if (inputs.length > 10) { this.report('batchLimit', []); return; }
    const { view, path, service } = this.context(), generation = this.generation, id = ++this.nextId;
    view.dispatch({ effects: addAnchor.of({ id, anchor: { ...range, from: range?.from ?? view.state.selection.main.from, to: range?.to ?? view.state.selection.main.to, valid: true } }) });
    this.pending(true);
    const run = async () => {
      let remaining = 50 * 1024 * 1024;
      const completed: string[] = [];
      const failures: ImageImportFailure[] = [];
      try {
        for (let nextIndex = 0; nextIndex < inputs.length; nextIndex++) {
          const input = inputs[nextIndex];
          try {
          if (generation !== this.generation) break;
          if (input instanceof File && input.size > 10 * 1024 * 1024) throw new Error('imageLimit');
          const source: MarkdownImageSource = input instanceof File ? await fileSource(input) : { kind: 'path', path: input.path };
          if (generation !== this.generation) break;
          const result = await service.importMarkdownImage({ documentPath: path, remainingBytes: remaining, source });
          completed.push(result.path); remaining -= result.size;
          if (generation !== this.generation) { this.report(this.invalidationReason, completed); return; }
          const anchor = view.state.field(imageAnchors).get(id);
          if (!anchor?.valid) { this.report('targetChanged', completed); return; }
          const parent = path.lastIndexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/') + 1) : '';
          const relative = result.path.startsWith(parent) ? result.path.slice(parent.length) : result.path;
          const url = relative.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
          const alt = result.name.replace(/[\\[\]]/g, '\\$&');
          const insert = `![${alt}](${url})`;
          const next = anchor.from + (anchor.prefix?.length ?? 0) + insert.length;
          view.dispatch({ changes: { from: anchor.from, to: anchor.to, insert: (anchor.prefix ?? '') + insert + (anchor.suffix ?? '') }, effects: addAnchor.of({ id, anchor: { from: next, to: next, valid: true } }), userEvent: 'input.image', annotations: isolateHistory.of('full') });
          } catch (error) {
            const message = importFailureMessage(error);
            failures.push({ input, error: message });
            if (/^unknown:/.test(message)) {
              // The write and remaining byte budget are uncertain. Do not
              // attempt more items or blindly create this asset again.
              this.report(message, completed, inputs.slice(nextIndex + 1), failures);
              return;
            }
          }
        }
        if (failures.length) this.report('failed', completed, failures.map(item => item.input), failures);
      }
      finally { if (generation === this.generation) view.dispatch({ effects: removeAnchor.of(id) }); }
    };
    const job = this.tail.then(run, run);
    this.tail = job;
    void job.finally(() => { if (this.tail === job) this.pending(false); });
  }
}

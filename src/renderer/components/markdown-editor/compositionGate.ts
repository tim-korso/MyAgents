import { Facet } from '@codemirror/state';

/** Document-scoped: the parent and its one active cell share composition
 * lifetime. Layout-changing actions run after CM has consumed the final DOM
 * mutation, never from inside the native compositionend event stack. */
export class CompositionGate {
  private targets = new Set<EventTarget>();
  private pending: { action(): void; resolve(value: boolean): void }[] = [];
  private frame = 0;
  private alive = true;
  constructor(private root: HTMLElement) {
    root.addEventListener('compositionstart', this.start, true);
    root.addEventListener('compositionend', this.end, true);
  }
  private start = (event: CompositionEvent) => { if (event.target) this.targets.add(event.target); };
  private end = (event: CompositionEvent) => {
    if (event.target) this.targets.delete(event.target);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.targets.size) for (const item of this.pending.splice(0)) { item.action(); item.resolve(true); }
    });
  };
  run(action: () => void): Promise<boolean> {
    if (!this.alive) return Promise.resolve(false);
    if (!this.targets.size && !this.frame) { action(); return Promise.resolve(true); }
    return new Promise(resolve => this.pending.push({ action, resolve }));
  }
  dispose() {
    this.alive = false;
    this.root.removeEventListener('compositionstart', this.start, true);
    this.root.removeEventListener('compositionend', this.end, true);
    cancelAnimationFrame(this.frame); this.targets.clear();
    for (const item of this.pending.splice(0)) item.resolve(false);
  }
}
export const compositionGate = Facet.define<CompositionGate, CompositionGate>({ combine: values => values[0] });

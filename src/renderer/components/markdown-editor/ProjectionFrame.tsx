import { useLayoutEffect, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';

/** Commits inside Suspense: retain the synchronous widget placeholder until
 * its content exists, then let CM measure intrinsic sizes. A first empty
 * widget must not make CM anchor the viewport to the paragraph after it. */
export default function ProjectionFrame({ element, view, children }: { element: HTMLElement; view: EditorView; children: ReactNode }) {
  useLayoutEffect(() => {
    element.style.removeProperty('min-height');
    const resize = new ResizeObserver(() => view.requestMeasure());
    resize.observe(element); view.requestMeasure();
    return () => resize.disconnect();
  }, [element, view]);
  return children;
}

import { useLayoutEffect, type RefObject } from 'react';

/** Text that participates in this cell's presentation, excluding hidden math/editor chrome. */
function cellText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
  // Live-preview cells carry document footnote definitions, hidden by editor CSS.
  if (node.matches('.md-projection .footnotes, .md-footnote-label')) return '';
  if (node.classList.contains('katex')) return node.querySelector('annotation')?.textContent ?? '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'IMG') return node.getAttribute('alt') ?? '';
  if (['SCRIPT', 'STYLE', 'BUTTON'].includes(node.tagName)) return '';
  const text = Array.from(node.childNodes, cellText).join('');
  return ['P', 'DIV', 'LI'].includes(node.tagName) ? text + '\n' : text;
}

/**
 * Keep a zero-height CSS intrinsic-size probe in sync with mounted cell content.
 * CSS caps each probe at the readable-width token; native table layout combines
 * the cell contributions per column. No resize measurements or document scans.
 */
export function useTableIntrinsicSizing(ref: RefObject<HTMLTableElement | null>, enabled = true) {
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table || !enabled) return;
    const update = (cell: HTMLTableCellElement) => {
      if (cell.closest('table') !== table || cell.parentElement?.getAttribute('aria-hidden') === 'true') return;
      const content = cell.querySelector('.md-cell-editor .cm-content') ?? cell;
      const text = cellText(content).trim();
      if (cell.dataset.tableSizing !== text) cell.setAttribute('data-table-sizing', text);
    };
    for (const row of table.rows) for (const cell of row.cells) update(cell);
    const observer = new MutationObserver(records => {
      const cells = new Set<HTMLTableCellElement>();
      for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        const cell = element?.closest<HTMLTableCellElement>('td, th');
        if (cell) cells.add(cell);
        for (const added of record.addedNodes) {
          if (!(added instanceof Element)) continue;
          if (added.matches('td, th')) cells.add(added as HTMLTableCellElement);
          for (const child of added.querySelectorAll<HTMLTableCellElement>('td, th')) cells.add(child);
        }
      }
      for (const cell of cells) if (table.contains(cell)) update(cell);
    });
    // Attribute writes above are deliberately outside the observed mutation set.
    observer.observe(table, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
}

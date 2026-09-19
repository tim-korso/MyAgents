/** Portable snapshot of one sanitized Markdown table; never reads UI controls. */
export interface TableExportNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: TableExportNode[];
}
export interface TableSnapshot { html: string; text: string; rows: string[][] }
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const classNames = (node: TableExportNode) => String(node.properties?.className ?? '').split(/[ ,]/);
function annotation(node: TableExportNode): string | undefined {
  if (node.tagName === 'annotation') return node.children?.map(child => child.value ?? '').join('');
  for (const child of node.children ?? []) { const value = annotation(child); if (value !== undefined) return value; }
}
function inline(node: TableExportNode): { html: string; text: string } {
  if (node.type === 'text') return { html: escapeHtml(node.value ?? ''), text: node.value ?? '' };
  if (node.tagName === 'br') return { html: '<br>', text: '\n' };
  if (node.tagName === 'img') { const alt = String(node.properties?.alt ?? ''); return { html: escapeHtml(alt), text: alt }; }
  if (classNames(node).includes('katex')) { const text = annotation(node) ?? ''; return { html: escapeHtml(text), text }; }
  // Drop executable/non-content nodes even if the caller accidentally bypasses sanitize.
  if (['script', 'style', 'iframe', 'object'].includes(node.tagName ?? '')) return { html: '', text: '' };
  const content = (node.children ?? []).map(inline);
  let html = content.map(child => child.html).join('');
  const text = content.map(child => child.text).join('');
  if (['strong', 'b', 'em', 'i', 'del', 's', 'sub', 'sup', 'code', 'kbd', 'mark', 'u'].includes(node.tagName ?? '')) html = `<${node.tagName}>${html}</${node.tagName}>`;
  if (node.tagName === 'a') {
    const href = String(node.properties?.href ?? '');
    if (/^(https?:\/\/|mailto:)/i.test(href)) html = `<a href="${escapeHtml(href)}">${html}</a>`;
  }
  return { html, text };
}
function tableRows(node: TableExportNode): TableExportNode[] {
  return (node.children ?? []).flatMap(child => child.tagName === 'tr' ? [child] : ['thead', 'tbody', 'tfoot'].includes(child.tagName ?? '') ? tableRows(child) : []);
}
/** TSV quoting protects embedded tabs/newlines/quotes for spreadsheet paste. */
export function tableTsv(rows: string[][]): string {
  return rows.map(row => row.map(value => /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join('\t')).join('\r\n');
}
export function tableSnapshotFromHast(table: TableExportNode): TableSnapshot {
  const rows: string[][] = [];
  const htmlRows = tableRows(table).map(row => {
    const values: string[] = [];
    const html = (row.children ?? []).filter(cell => cell.tagName === 'td' || cell.tagName === 'th').map(cell => {
      const content = inline(cell);
      values.push(content.text);
      const align = ['left', 'center', 'right'].includes(String(cell.properties?.align)) ? String(cell.properties?.align) : 'left';
      // Excel understands the text format; numbers/identifiers remain literal.
      return `<${cell.tagName} style="border:1px solid #d8d8d8;padding:6px 10px;text-align:${align};vertical-align:top;mso-number-format:'\\@'">${content.html}</${cell.tagName}>`;
    }).join('');
    rows.push(values);
    return `<tr>${html}</tr>`;
  }).join('');
  return { rows, text: tableTsv(rows), html: `<table style="border-collapse:collapse;color:#222;background:#fff">${htmlRows}</table>` };
}
/** All cells are text: never turn untrusted Markdown into executable formulas. */
export async function tableXlsx(snapshot: TableSnapshot): Promise<Blob> {
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(snapshot.rows);
  const widths: number[] = [];
  for (const row of snapshot.rows) row.forEach((value, index) => {
    widths[index] = Math.min(60, Math.max(widths[index] ?? 12, value.length + 2));
  });
  sheet['!cols'] = widths.map(wch => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Table');
  return new Blob([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

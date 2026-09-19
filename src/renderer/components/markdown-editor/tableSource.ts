import { syntaxTree } from '@codemirror/language';
import { ChangeSet, StateEffect, StateField, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { ImageInsertionRange } from './imageImport';

export interface TableCellSource {
  readonly from: number; readonly to: number; readonly text: string;
  readonly slotFrom: number; readonly slotTo: number;
}
export interface TableRowSource {
  readonly from: number; readonly to: number; readonly prefix: string;
  readonly cells: readonly TableCellSource[];
  readonly leadingPipe: boolean; readonly trailingPipe: boolean;
}
export interface TableSource {
  readonly from: number; readonly to: number;
  readonly rows: { readonly length: number; at(index: number): TableRowSource | undefined; [Symbol.iterator](): IterableIterator<TableRowSource> };
  readonly delimiter: TableRowSource;
  readonly columns: number;
}

// The active mini edits an exact parent slice, including newly typed spaces.
// Parser-trimmed cell coordinates describe layout, not the live input range.
export const setCellEditRange = StateEffect.define<{ from: number; to: number } | null>();
export const cellEditRange = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    if (value) value = { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    for (const effect of tr.effects) if (effect.is(setCellEditRange)) value = effect.value;
    return value;
  },
});

function rowSource(state: EditorState, node: SyntaxNode): TableRowSource {
  const delimiters: number[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') delimiters.push(child.from);
  }
  // The separator row is a single delimiter node; its grammar contains only
  // alignment punctuation/whitespace, so scanning its pipes is unambiguous.
  if (node.name === 'TableDelimiter' || node.name === 'LiveTableDelimiter') {
    const value = state.sliceDoc(node.from, node.to);
    for (let index = 0; index < value.length; index++) if (value[index] === '|') delimiters.push(node.from + index);
  }
  const leadingPipe = delimiters[0] === node.from;
  const trailingPipe = delimiters.at(-1) === node.to - 1;
  const boundaries = [node.from, ...delimiters.map(pos => pos + 1), node.to + 1];
  const cells: TableCellSource[] = [];
  for (let index = leadingPipe ? 1 : 0; index < boundaries.length - 1 - Number(trailingPipe); index++) {
    const start = boundaries[index], end = Math.max(start, boundaries[index + 1] - 1);
    const raw = state.sliceDoc(start, end);
    const leading = /^\s*/.exec(raw)![0].length;
    const from = start + (leading === raw.length ? Math.ceil(leading / 2) : leading);
    const to = Math.max(from, end - /\s*$/.exec(raw)![0].length);
    cells.push({ from, to, text: state.sliceDoc(from, to), slotFrom: start, slotTo: end });
  }
  return { from: node.from, to: node.to, prefix: state.sliceDoc(state.doc.lineAt(node.from).from, node.from), cells, leadingPipe, trailingPipe };
}

export function tableAt(state: EditorState, position: number): TableSource | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(Math.min(position + 1, state.doc.length), -1);
  while (node && node.name !== 'Table' && node.name !== 'LiveTable') node = node.parent;
  return node ? tableFromNode(state, node) : null;
}

export function tableFromNode(state: EditorState, node: SyntaxNode): TableSource | null {
  // SyntaxNode.getChild builds getChildren's complete sibling list, even when
  // the requested header is first. Stop once the two leading rows are found.
  let headerNode: SyntaxNode | null = null, delimiterNode: SyntaxNode | null = null;
  for (let child = node.firstChild; child && (!headerNode || !delimiterNode); child = child.nextSibling) {
    if (child.name === 'LiveTableHeader' || child.name === 'TableHeader') headerNode = child;
    else if (child.name === 'LiveTableDelimiter' || child.name === 'TableDelimiter') delimiterNode = child;
  }
  if (!headerNode || !delimiterNode) return null;
  const header = rowSource(state, headerNode), delimiter = rowSource(state, delimiterNode);
  const firstLine = state.doc.lineAt(header.from).number;
  // GFM rows occupy one physical line, with one delimiter line after the
  // header. Reuse CM's indexed Text and syntax tree to resolve only requested
  // rows. Materializing every cell on each parent/mini transaction made large
  // tables slow even though their parser and DOM were already incremental.
  const length = state.doc.lineAt(node.to).number - firstLine;
  const at = (index: number): TableRowSource | undefined => {
    if (index < 0 || index >= length) return undefined;
    if (index === 0) return header;
    const line = state.doc.line(firstLine + index + 1);
    let row: SyntaxNode | null = node.resolveInner(line.to, -1);
    while (row && row.name !== 'TableRow' && row.name !== 'LiveTableRow') row = row.parent;
    return row && row.from >= node.from && row.to <= node.to ? rowSource(state, row) : undefined;
  };
  return { from: node.from, to: node.to, rows: { length, at, *[Symbol.iterator]() {
    for (let index = 0; index < length; index++) { const row = at(index); if (row) yield row; }
  } }, delimiter, columns: header.cells.length };
}

/** The active cell edits inline Markdown; only structural pipes are escaped. */
export function encodeCell(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, '<br>').replace(/(\\*)\|/g, (_match, slashes: string) =>
    slashes.length % 2 ? `${slashes}|` : `${slashes}\\|`);
}

export function replaceCell(table: TableSource, row: number, column: number, text: string, range?: { from: number; to: number }): ChangeSpec {
  const target = table.rows.at(row);
  if (!target || column < 0 || column >= table.columns) throw new Error('Invalid table cell');
  const cell = target.cells[column];
  if (cell) {
    const { from, to } = range ?? cell, encoded = encodeCell(text);
    // A trailing escape must never consume the structural pipe immediately
    // after an unpadded cell. The added space belongs to layout, not input.
    const padding = to === cell.slotTo && (column < target.cells.length - 1 || target.trailingPipe) && /(?:^|[^\\])(?:\\\\)*\\$/.test(encoded) ? ' ' : '';
    return { from, to, insert: encoded + padding };
  }
  const missing = column - target.cells.length;
  const from = target.to - Number(target.trailingPipe);
  return { from, insert: `${target.trailingPipe ? '|' : ' |'}${'  |'.repeat(missing)} ${encodeCell(text)} ${target.trailingPipe ? '' : '|'}` };
}

/** Materialize an absent GFM cell only in the successful image transaction. */
export function cellImageRange(table: TableSource, row: number, column: number): ImageInsertionRange {
  const cell = table.rows.at(row)?.cells[column];
  if (cell) return { from: cell.to, to: cell.to };
  const change = replaceCell(table, row, column, '@') as { from: number; insert: string };
  const [prefix, suffix] = change.insert.split('@');
  return { from: change.from, to: change.from, prefix, suffix };
}

export type TableAction = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column' | 'align-left' | 'align-center' | 'align-right';

export function tableAction(state: EditorState, table: TableSource, action: TableAction, row: number, column: number): ChangeSpec {
  const target = table.rows.at(Math.max(0, Math.min(row, table.rows.length - 1)));
  if (!target) throw new Error('Invalid table row');
  if (action === 'row-before' || action === 'row-after') {
    const before = action === 'row-before' && row > 0;
    const anchor = row === 0 ? table.delimiter : target;
    const insert = `|${'  |'.repeat(table.columns)}`;
    return before
      ? { from: state.doc.lineAt(target.from).from, insert: `${target.prefix}${insert}\n` }
      : { from: anchor.to, insert: `\n${anchor.prefix}${insert}` };
  }
  if (action === 'delete-row') {
    if (row === 0) return [];
    const line = state.doc.lineAt(target.from);
    return line.to < state.doc.length ? { from: line.from, to: line.to + 1 }
      : { from: Math.max(table.delimiter.to, line.from - 1), to: line.to };
  }
  if (action.startsWith('align-')) {
    const cell = table.delimiter.cells[column];
    if (!cell) throw new Error('Invalid alignment column');
    return { from: cell.from, to: cell.to, insert: action === 'align-left' ? ':---' : action === 'align-right' ? '---:' : ':---:' };
  }
  if (action === 'delete-column' && table.columns === 1) {
    return { from: table.from, to: table.to };
  }
  const index = action === 'column-after' ? column + 1 : column;
  return [...table.rows, table.delimiter].flatMap(current => {
    const isDelimiter = current === table.delimiter;
    const cells = current.cells;
    if (action === 'delete-column') {
      const cell = cells[column];
      if (!cell) return [];
      if (column < cells.length - 1) return [{ from: cell.slotFrom, to: cells[column + 1].slotFrom, insert: '' }];
      if (column > 0) return [{ from: cells[column - 1].slotTo, to: cell.slotTo, insert: '' }];
      return [{ from: cell.from, to: cell.to, insert: '' }];
    }
    const value = isDelimiter ? '---' : '';
    if (index < cells.length) {
      // Keep every existing cell's exact source, including its padding. A
      // new empty leading cell needs an outer pipe to be representable.
      return [{ from: cells[index].slotFrom, to: cells[index].slotFrom,
        insert: `${index === 0 && !current.leadingPipe ? '| ' : ''} ${value} |` }];
    }
    const from = current.to - Number(current.trailingPipe);
    const missing = Math.max(0, index - cells.length);
    return [{ from, to: from, insert: `${current.trailingPipe ? '|' : ' |'}${'  |'.repeat(missing)} ${value} ${current.trailingPipe ? '' : '|'}` }];
  }).sort((a, b) => a.from - b.from);
}

/** Rectangular clipboard input is one parent transaction/history item. */
export function pasteTableCells(state: EditorState, table: TableSource, row: number, column: number, clipboard: string): ChangeSpec {
  const grid = clipboard.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t').map(encodeCell));
  const columns = Math.max(table.columns, column + Math.max(...grid.map(cells => cells.length)));
  let current = state, model = table, changes = ChangeSet.empty(state.doc.length);
  const apply = (spec: ChangeSpec) => {
    const tr = current.update({ changes: spec });
    changes = changes.compose(tr.changes);
    current = tr.state;
    model = tableAt(current, table.from)!;
    if (!model) throw new Error('Table structure changed');
  };
  while (model.columns < columns) apply(tableAction(current, model, 'column-after', 0, model.columns - 1));
  while (model.rows.length < row + grid.length) apply(tableAction(current, model, 'row-after', model.rows.length - 1, 0));
  grid.forEach((cells, rowIndex) => cells.forEach((text, columnIndex) => {
    apply(replaceCell(model, row + rowIndex, column + columnIndex, text));
  }));
  return changes;
}

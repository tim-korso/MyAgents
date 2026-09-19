import { diffArrays, type ChangeObject } from 'diff';

export type DiffSide = 'local' | 'disk';
export interface SourceLine { readonly text: string; readonly ending: string; readonly number: number }
export interface DiffRow {
  readonly id: number;
  readonly local?: SourceLine;
  readonly disk?: SourceLine;
  readonly changed: boolean;
  readonly kind: 'line' | 'bom';
}
export interface LineComparison { readonly rows: readonly DiffRow[]; readonly simplified: boolean }

function splitLines(raw: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (const match of raw.matchAll(pattern)) {
    if (!match[0]) break;
    lines.push({ text: match[1], ending: match[2], number: lines.length + 1 });
  }
  return lines;
}

const lineEquals = (a: SourceLine, b: SourceLine) => a.text === b.text && a.ending === b.ending;

function alignRows(local: SourceLine[], disk: SourceLine[], changes?: ChangeObject<SourceLine[]>[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const append = (a: SourceLine[], b: SourceLine[]) => {
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      rows.push({ id: rows.length, local: a[index], disk: b[index], kind: 'line',
        changed: !a[index] || !b[index] || !lineEquals(a[index], b[index]) });
    }
  };
  if (!changes) {
    // Bounded positional alignment preserves both originals, even when Myers
    // exceeds its budget. It never substitutes "no differences" for failure.
    let prefix = 0;
    while (prefix < local.length && prefix < disk.length && lineEquals(local[prefix], disk[prefix])) prefix++;
    let suffix = 0;
    while (suffix < local.length - prefix && suffix < disk.length - prefix &&
      lineEquals(local[local.length - 1 - suffix], disk[disk.length - 1 - suffix])) suffix++;
    append(local.slice(0, prefix), disk.slice(0, prefix));
    append(local.slice(prefix, local.length - suffix), disk.slice(prefix, disk.length - suffix));
    if (suffix) append(local.slice(-suffix), disk.slice(-suffix));
    return rows;
  }
  let a = 0, b = 0;
  for (let index = 0; index < changes.length;) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      append(local.slice(a, a + change.count), disk.slice(b, b + change.count));
      a += change.count; b += change.count; index++;
    } else {
      const startA = a, startB = b;
      while (index < changes.length && (changes[index].added || changes[index].removed)) {
        const item = changes[index++];
        if (item.removed) a += item.count;
        else b += item.count;
      }
      append(local.slice(startA, a), disk.slice(startB, b));
    }
  }
  return rows;
}

export async function compareSourceLines(localRaw: string, diskRaw: string, simplified = false): Promise<LineComparison> {
  const localBom = localRaw.startsWith('\uFEFF'), diskBom = diskRaw.startsWith('\uFEFF');
  const local = splitLines(localBom ? localRaw.slice(1) : localRaw);
  const disk = splitLines(diskBom ? diskRaw.slice(1) : diskRaw);
  const changes = simplified ? undefined : await new Promise<ChangeObject<SourceLine[]>[] | undefined>(resolve => {
    diffArrays(local, disk, { comparator: lineEquals, timeout: 1000, maxEditLength: 2048, callback: resolve });
  });
  const rows = alignRows(local, disk, changes);
  if (localBom || diskBom) rows.unshift({
    id: -1, kind: 'bom', changed: localBom !== diskBom,
    local: localBom ? { text: '\uFEFF', ending: '', number: 1 } : undefined,
    disk: diskBom ? { text: '\uFEFF', ending: '', number: 1 } : undefined,
  });
  return { rows, simplified: !changes };
}

export function unresolvedRows(comparison: LineComparison, choices: ReadonlyMap<number, DiffSide>): number {
  return comparison.rows.reduce((count, row) => count + Number(row.changed && !choices.has(row.id)), 0);
}

export function combineSourceLines(comparison: LineComparison, choices: ReadonlyMap<number, DiffSide>): string {
  if (unresolvedRows(comparison, choices)) throw new Error('Unresolved source lines');
  let bom = '';
  const lines: SourceLine[] = [];
  for (const row of comparison.rows) {
    const selected = row.changed ? row[choices.get(row.id)!] : row.local;
    if (row.kind === 'bom') { bom = selected?.text ?? ''; continue; }
    if (selected) lines.push(selected);
  }
  const preferred = lines.find(line => line.ending)?.ending ?? '\n';
  const endings = lines.map((line, index) => line.ending || (index < lines.length - 1 ? preferred : ''));
  return bom + lines.map((line, index) => {
    // Mixed choices can put a CR directly before an empty LF line. Make the
    // first separator explicit so reopening cannot collapse two chosen lines.
    // Include EOF connections; complete-side choices never create this join.
    const ending = endings[index] === '\r' && lines[index + 1]?.text === '' && endings[index + 1] === '\n'
      ? '\r\n' : endings[index];
    return line.text + ending;
  }).join('');
}

export interface DiffBlock { readonly from: number; readonly to: number }
export function comparisonBlocks(comparison: LineComparison, context = 3): DiffBlock[] {
  const blocks: { from: number; to: number }[] = [];
  comparison.rows.forEach((row, index) => {
    if (!row.changed) return;
    const from = Math.max(0, index - context), to = Math.min(comparison.rows.length, index + context + 1);
    const last = blocks.at(-1);
    if (last && from <= last.to) last.to = to;
    else blocks.push({ from, to });
  });
  return blocks;
}

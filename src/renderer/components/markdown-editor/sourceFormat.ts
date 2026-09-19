import { invertedEffects } from '@codemirror/commands';
import { RangeSet, RangeValue, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';

export type LineSeparator = '\n' | '\r\n' | '\r';

class Ending extends RangeValue {
  readonly startSide = 1;
  readonly endSide = -1;
  constructor(readonly separator: LineSeparator) { super(); }
  eq(other: Ending) { return this.separator === other.separator; }
}

export interface SourceFormat {
  readonly bom: boolean;
  readonly endings: RangeSet<Ending>;
  readonly preferred: LineSeparator;
}

/** The editing coordinates exclude the BOM and use one character per newline. */
export function decodeSource(raw: string): { text: string; format: SourceFormat } {
  const bom = raw.startsWith('\uFEFF');
  const input = bom ? raw.slice(1) : raw;
  const ranges: Range<Ending>[] = [];
  const counts = new Map<LineSeparator, number>();
  let offset = 0;
  const text = input.replace(/\r\n|\r|\n/g, (match: string, index: number) => {
    const separator = match as LineSeparator;
    ranges.push(new Ending(separator).range(index - offset, index - offset + 1));
    offset += separator.length - 1;
    counts.set(separator, (counts.get(separator) ?? 0) + 1);
    return '\n';
  });
  const preferred = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
  return { text, format: { bom, endings: RangeSet.of(ranges), preferred } };
}

export const restoreSourceFormat = StateEffect.define<SourceFormat>();

export const sourceFormatField = StateField.define<SourceFormat>({
  create(state) { return decodeSource(state.doc.toString()).format; },
  update(format, tr) {
    // History carries the actual separators, not a second mutable text buffer.
    for (const effect of tr.effects) if (effect.is(restoreSourceFormat)) return effect.value;
    if (!tr.docChanged) return format;
    // RangeSet mapping preserves some replacement-boundary ranges. Remove
    // consumed separators in the OLD coordinates before adding inserted ones.
    let retained = format.endings;
    tr.changes.iterChangedRanges((from, to) => {
      if (to > from) retained = retained.update({ filterFrom: from, filterTo: to,
        filter: (start, end) => end <= from || start >= to });
    });
    let endings = retained.map(tr.changes);
    const additions: Range<Ending>[] = [];
    tr.changes.iterChanges((fromA, _toA, fromB, _toB, inserted) => {
      let separator = format.preferred;
      const line = tr.startState.doc.lineAt(fromA);
      const nearby = format.endings.iter(line.to);
      if (nearby.value) separator = nearby.value.separator;
      else if (line.number > 1) {
        const previous = format.endings.iter(tr.startState.doc.line(line.number - 1).to);
        if (previous.value) separator = previous.value.separator;
      }
      const text = inserted.toString();
      for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) {
        additions.push(new Ending(separator).range(fromB + index, fromB + index + 1));
      }
    });
    if (additions.length) endings = endings.update({ add: additions, sort: true });
    // A deletion can bring a standalone CR next to LF. Those two logical
    // newlines would otherwise serialize as one CRLF and lose an empty line
    // on reopen. Disambiguate only newly adjacent separators; history retains
    // the original format for undo. Unchanged regions never need scanning.
    const disambiguated = new Map<number, Range<Ending>>();
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      endings.between(Math.max(0, fromB - 1), Math.min(tr.newDoc.length, toB + 1), (from, to, ending) => {
        if (ending.separator !== '\r') return;
        const next = endings.iter(to);
        while (next.value && next.from < to) next.next();
        if (next.from === to && next.value?.separator === '\n') {
          disambiguated.set(from, new Ending('\r\n').range(from, to));
        }
      });
    });
    if (disambiguated.size) endings = endings.update({
      filter: from => !disambiguated.has(from), add: [...disambiguated.values()], sort: true,
    });
    return { ...format, endings };
  },
});

export function sourceFormatExtensions(raw: string): Extension {
  return [
    sourceFormatField.init(() => decodeSource(raw).format),
    invertedEffects.of(tr => tr.docChanged || tr.effects.some(effect => effect.is(restoreSourceFormat))
      ? [restoreSourceFormat.of(tr.startState.field(sourceFormatField))] : []),
  ];
}

/** Materialize only at IO/quote boundaries; the EditorState is the live draft. */
export function encodeSource(state: EditorState): string {
  const format = state.field(sourceFormatField);
  const text = state.doc.toString();
  const output = [format.bom ? '\uFEFF' : ''];
  let offset = 0;
  format.endings.between(0, text.length, (from, to, ending) => {
    if (from < offset || to !== from + 1 || text[from] !== '\n') throw new Error('Invalid source line mapping');
    output.push(text.slice(offset, from), ending.separator);
    offset = to;
  });
  output.push(text.slice(offset));
  return output.join('');
}

import { describe, expect, it } from 'vitest';

import {
  LOOP_ABORT_THRESHOLD,
  LOOP_HISTORY_LIMIT,
  LOOP_REPEAT_THRESHOLD,
  detectToolLoop,
  normalizeToolArgs,
  type ToolCallSignature,
} from './tool-loop-detector';

const call = (name: string, args: unknown): ToolCallSignature => ({
  name,
  args: normalizeToolArgs(args),
});

// A repeating loop is self-sustaining: the model re-issues the call, sees the
// same output, and concludes nothing new. It never raises an error, so the only
// way to notice is to count consecutive identical calls.
describe('detectToolLoop', () => {
  it('does not fire on the first few repeats', () => {
    const history: ToolCallSignature[] = [];
    const bash = call('Bash', { command: 'ls' });
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD - 1; i += 1) {
      expect(detectToolLoop(history, bash).looping).toBe(false);
    }
  });

  it('fires once the same call repeats past the threshold', () => {
    const history: ToolCallSignature[] = [];
    const bash = call('Bash', { command: 'ls' });
    let verdict = detectToolLoop(history, bash);
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD - 2; i += 1) {
      verdict = detectToolLoop(history, bash);
    }
    verdict = detectToolLoop(history, bash);

    expect(verdict.looping).toBe(true);
    expect(verdict.repeatCount).toBe(LOOP_REPEAT_THRESHOLD);
    expect(verdict.correction).toBeTruthy();
  });

  it('breaks the run when a different call intervenes', () => {
    const history: ToolCallSignature[] = [];
    const ls = call('Bash', { command: 'ls' });
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD; i += 1) detectToolLoop(history, ls);
    // Something else happens — the model is exploring, not stuck.
    detectToolLoop(history, call('Read', { file_path: '/tmp/x' }));

    expect(detectToolLoop(history, ls).looping).toBe(false);
  });

  it('treats the same tool with different arguments as progress', () => {
    const history: ToolCallSignature[] = [];
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD + 2; i += 1) {
      const verdict = detectToolLoop(history, call('Read', { file_path: `/tmp/f${i}` }));
      expect(verdict.looping).toBe(false);
    }
  });

  it('does not confuse two tools with the same arguments', () => {
    const history: ToolCallSignature[] = [];
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD; i += 1) detectToolLoop(history, call('Read', { p: 1 }));
    expect(detectToolLoop(history, call('Grep', { p: 1 })).looping).toBe(false);
  });

  it('bounds retained history so an old run cannot leak into a new one', () => {
    const history: ToolCallSignature[] = [];
    const stuck = call('Bash', { command: 'ls' });
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD; i += 1) detectToolLoop(history, stuck);
    for (let i = 0; i < LOOP_HISTORY_LIMIT; i += 1) detectToolLoop(history, call('Read', { i }));

    expect(history.length).toBeLessThanOrEqual(LOOP_HISTORY_LIMIT);
    expect(detectToolLoop(history, stuck).looping).toBe(false);
  });

  it('names the repeated tool and a concrete next step in the correction', () => {
    const history: ToolCallSignature[] = [];
    const bash = call('Bash', { command: 'false' });
    let verdict = detectToolLoop(history, bash);
    for (let i = 0; i < LOOP_REPEAT_THRESHOLD - 1; i += 1) verdict = detectToolLoop(history, bash);

    expect(verdict.correction).toContain('Bash');
    // Tells the model where to go, not just that it is repeating.
    expect(verdict.correction).toMatch(/重新读取|换一种方法|阻塞/);
  });
});

describe('normalizeToolArgs', () => {
  it('is insensitive to key order', () => {
    expect(normalizeToolArgs({ a: 1, b: 2 })).toBe(normalizeToolArgs({ b: 2, a: 1 }));
  });

  it('sorts nested objects too', () => {
    expect(normalizeToolArgs({ outer: { x: 1, y: 2 } }))
      .toBe(normalizeToolArgs({ outer: { y: 2, x: 1 } }));
  });

  it('preserves array order because it is semantic', () => {
    expect(normalizeToolArgs([1, 2])).not.toBe(normalizeToolArgs([2, 1]));
  });

  it('drops undefined so an omitted key matches an explicit undefined', () => {
    expect(normalizeToolArgs({ a: 1, b: undefined })).toBe(normalizeToolArgs({ a: 1 }));
  });

  it('does not throw on unserializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => normalizeToolArgs(circular)).not.toThrow();
  });
});

// A model that ignores the correction must not loop forever: past the abort
// threshold the caller stops the turn, so an unending stream of denials never
// becomes a slower version of the hang this detector exists to fix.
describe('loop abort threshold', () => {
  it('reports exhausted only after the model ignores the correction', () => {
    const history: ToolCallSignature[] = [];
    const bash = call('Bash', { command: 'false' });
    let verdict = detectToolLoop(history, bash);
    for (let i = 1; i < LOOP_ABORT_THRESHOLD; i += 1) {
      verdict = detectToolLoop(history, bash);
      if (i < LOOP_ABORT_THRESHOLD - 1) expect(verdict.exhausted).toBe(false);
    }
    expect(verdict.exhausted).toBe(true);
    expect(verdict.looping).toBe(true);
  });

  it('a corrected model that changes approach resets to not-exhausted', () => {
    const history: ToolCallSignature[] = [];
    const bang = call('Bash', { command: 'false' });
    for (let i = 0; i < LOOP_ABORT_THRESHOLD; i += 1) detectToolLoop(history, bang);

    // Different call — the loop is broken.
    const after = detectToolLoop(history, call('Read', { file_path: '/tmp/x' }));
    expect(after.exhausted).toBe(false);
    expect(after.looping).toBe(false);
  });
});

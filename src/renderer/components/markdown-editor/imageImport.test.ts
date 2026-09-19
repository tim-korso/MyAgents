import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { MarkdownImportedFile, WorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { ImageImportQueue, imageAnchors } from './imageImport';

const asset = (name = '图 (1).png'): MarkdownImportedFile => ({ path: `docs/note_assets/${name}`, name, size: 30, mimeType: 'image/png' });
function fixture() {
  const host = { state: EditorState.create({ doc: 'before TARGET after', selection: { anchor: 7, head: 13 }, extensions: [imageAnchors] }),
    dispatch(spec: TransactionSpec) { this.state = this.state.update(spec).state; } };
  const write = vi.fn<(args: unknown) => Promise<MarkdownImportedFile>>();
  const report = vi.fn(), pending = vi.fn();
  const service = { importMarkdownImage: write } as unknown as WorkspaceFileService;
  const queue = new ImageImportQueue(() => ({ view: host as unknown as EditorView, path: 'docs/note.md', service }), report, pending);
  return { host, write, report, pending, queue };
}

describe('document image import lifetime', () => {
  it('replaces the captured selection, maps intervening edits, and encodes actual returned names', async () => {
    const { host, write, queue } = fixture();
    let finish!: (value: MarkdownImportedFile) => void;
    write.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    queue.enqueue([{ path: '/image.png' }]);
    await Promise.resolve();
    host.dispatch({ changes: { from: 0, insert: 'new ' } });
    finish(asset()); await queue.settled();
    expect(host.state.doc.toString()).toBe('new before ![图 (1).png](note_assets/%E5%9B%BE%20%281%29.png) after');
    expect(host.state.field(imageAnchors).size).toBe(0);
  });

  it('does not guess a new insertion position after the target is deleted', async () => {
    const { host, write, queue, report } = fixture();
    let finish!: (value: MarkdownImportedFile) => void;
    write.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    queue.enqueue([{ path: '/image.png' }]); await Promise.resolve();
    host.dispatch({ changes: { from: 7, to: 13, insert: 'edited' } });
    finish(asset()); await queue.settled();
    expect(host.state.doc.toString()).toBe('before edited after');
    expect(report).toHaveBeenCalledWith('targetChanged', [asset().path]);
  });

  it('invalidates insertion on a path generation change while retaining completed paths', async () => {
    const { host, write, queue, report } = fixture();
    let finish!: (value: MarkdownImportedFile) => void;
    write.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    queue.enqueue([{ path: '/image.png' }, { path: '/second.png' }]); await Promise.resolve();
    queue.invalidate(); finish(asset()); await queue.settled();
    expect(host.state.doc.toString()).toBe('before TARGET after');
    expect(write).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('targetChanged', [asset().path]);
    expect(host.state.field(imageAnchors).size).toBe(0);
  });

  it('retains successful links on partial failure and reduces the remaining byte allowance', async () => {
    const { host, write, queue, report } = fixture();
    write.mockResolvedValueOnce(asset('one.png')).mockRejectedValueOnce('IO failed');
    queue.enqueue([{ path: '/one.png' }, { path: '/two.png' }]); await queue.settled();
    expect(write.mock.calls[1][0]).toMatchObject({ documentPath: 'docs/note.md', remainingBytes: 50 * 1024 * 1024 - 30 });
    expect(host.state.doc.toString()).toBe('before ![one.png](note_assets/one.png) after');
    expect(report).toHaveBeenCalledWith('failed', ['docs/note_assets/one.png'], [{ path: '/two.png' }], [{ input: { path: '/two.png' }, error: 'IO failed' }]);
  });
  it('continues after a known failure and retries only the failed file', async () => {
    const { write, queue, report, host } = fixture();
    write.mockResolvedValueOnce(asset('one.png')).mockRejectedValueOnce('Unsupported image format').mockResolvedValueOnce(asset('three.png'));
    queue.enqueue([{ path: '/one.png' }, { path: '/bad.txt' }, { path: '/three.png' }]); await queue.settled();
    expect(write).toHaveBeenCalledTimes(3);
    expect(host.state.doc.toString()).toContain('![three.png]');
    expect(report.mock.calls[0][2]).toEqual([{ path: '/bad.txt' }]);
    expect(write.mock.calls[2][0]).toMatchObject({ remainingBytes: 50 * 1024 * 1024 - 30 });
  });
  it.each(['IPC disconnected', 'Workspace write status unknown after publication: Failed to inspect destination parent'])('pauses after an unknown receipt (%s) without retrying or charging a guessed budget', async (message) => {
    const { write, queue, report } = fixture();
    write.mockRejectedValueOnce(message);
    queue.enqueue([{ path: '/one.png' }, { path: '/two.png' }]); await queue.settled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]).toEqual([`unknown: ${message}`, [], [{ path: '/two.png' }], [{ input: { path: '/one.png' }, error: `unknown: ${message}` }]]);
  });
});

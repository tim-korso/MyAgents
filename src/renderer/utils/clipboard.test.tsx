import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyRichText } from './clipboard';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
describe('rich clipboard', () => {
  it('writes HTML and plain text as one item, including deferred representations', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });
    class Item { constructor(public data: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal('ClipboardItem', Item);
    await copyRichText(Promise.resolve('<table></table>'), Promise.resolve('a\tb'));
    const item = write.mock.calls[0][0][0] as Item;
    expect(Object.keys(item.data)).toEqual(['text/html', 'text/plain']);
    expect((await item.data['text/html']).type).toBe('text/html');
    expect((await item.data['text/plain']).type).toBe('text/plain');
    expect(write).toHaveBeenCalledOnce();
  });
  it('uses a copy-event fallback and restores the focused editor and selection', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('ClipboardItem', class {});
    const input = document.createElement('input'); document.body.append(input); input.focus();
    const values: Record<string, string> = {};
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (key: string, value: string) => { values[key] = value; } } });
      document.activeElement!.dispatchEvent(event); return true;
    }) });
    await copyRichText('<table></table>', 'a\tb');
    expect(values).toEqual({ 'text/html': '<table></table>', 'text/plain': 'a\tb' });
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('reports failure rather than claiming a plain-only fallback copied rich data', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
    await expect(copyRichText('<table></table>', 'a')).rejects.toThrow('unavailable');
  });
});

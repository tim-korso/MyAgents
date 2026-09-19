import { act, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useTableIntrinsicSizing } from './useTableIntrinsicSizing';

function Surface({ text = '01', enabled = true }: { text?: string; enabled?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  useTableIntrinsicSizing(ref, enabled);
  return enabled ? <table ref={ref}><tbody>
    <tr><th>编号</th><td>{text}</td><td><strong>粗体</strong><br /><a href="https://example.com/very-long-url">短链接</a></td>
      <td><span className="katex" dangerouslySetInnerHTML={{ __html: '<span aria-hidden="true">duplicate</span><annotation>x^2</annotation>' }} /></td></tr>
    <tr aria-hidden="true"><td colSpan={4} /></tr>
  </tbody></table> : null;
}

describe('table intrinsic sizing metadata', () => {
  it('uses displayed labels and explicit lines without changing copyable DOM text or sizing spacer rows', () => {
    const { container } = render(<Surface />);
    const cells = container.querySelectorAll('th,td');
    expect([...cells].map(cell => cell.getAttribute('data-table-sizing'))).toEqual(['编号', '01', '粗体\n短链接', 'x^2', null]);
    expect(cells[1].textContent).toBe('01');
    expect(cells[2].querySelector('a')?.textContent).toBe('短链接');
    expect(container.querySelectorAll('td')).toHaveLength(4);
  });
  it('updates streaming text and newly mounted virtual rows, and disconnects on unmount', async () => {
    const { container, rerender, unmount } = render(<Surface />);
    const cell = container.querySelector('td')!;
    rerender(<Surface text="00123" />);
    await waitFor(() => expect(cell.dataset.tableSizing).toBe('00123'));
    await act(async () => {
      const row = document.createElement('tr');
      const added = document.createElement('td'); added.textContent = '后来挂载的长内容'; row.append(added);
      container.querySelector('tbody')!.append(row);
    });
    expect(container.querySelector('tr:last-child td')?.getAttribute('data-table-sizing')).toBe('后来挂载的长内容');
    unmount();
    await act(async () => { cell.textContent = 'detached'; });
    expect(cell.dataset.tableSizing).toBe('00123');
  });
  it('attaches when a table becomes available and follows the active editor text', async () => {
    const { container, rerender } = render(<Surface enabled={false} />);
    rerender(<Surface />);
    const cell = container.querySelector('td')!;
    expect(cell.dataset.tableSizing).toBe('01');
    await act(async () => {
      cell.innerHTML = '<div class="md-cell-editor"><div class="cm-gutters">99</div><div class="cm-content"><div class="cm-line">02</div></div></div>';
    });
    expect(cell.dataset.tableSizing).toBe('02');
  });
});

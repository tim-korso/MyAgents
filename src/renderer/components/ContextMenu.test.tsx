import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import { TabApiContext, TabActiveContext, type TabApiContextValue } from '@/context/TabContext';

describe('ContextMenu', () => {
  it('renders item labels and fires onClick + onClose on an enabled item', async () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [{ label: '引用文件', onClick }];
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);

    const item = screen.getByRole('button', { name: '引用文件' });
    expect(item).toBeInTheDocument();
    await userEvent.click(item);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick for a disabled item', async () => {
    const onClick = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={[{ label: 'Delete', disabled: true, onClick }]} onClose={vi.fn()} />,
    );
    const item = screen.getByRole('button', { name: 'Delete' });
    expect(item).toBeDisabled();
    await userEvent.click(item).catch(() => { /* user-event refuses to click a disabled element */ });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders separators as non-button dividers', () => {
    const items: ContextMenuItem[] = [
      { label: 'A', onClick: vi.fn() },
      { separator: true },
      { label: 'B', onClick: vi.fn() },
    ];
    render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(2); // separator is not a button
  });
  it('portals outside a clipped host above document previews', () => {
    const view = render(<div data-testid="clipping-host" style={{ overflow: 'hidden', transform: 'translateX(0)' }}><ContextMenu x={20} y={20} items={[{ label: 'Preview', onClick: vi.fn() }]} onClose={vi.fn()} /></div>);
    const menu = screen.getByRole('button', { name: 'Preview' }).parentElement!;
    expect(menu.parentElement).toBe(document.body);
    expect(view.container).not.toContainElement(menu);
    expect(menu).toHaveStyle({ zIndex: 320 });
  });
  it('dismisses its portal when the owning tab becomes hidden', () => {
    const onClose = vi.fn();
    const api: TabApiContextValue = { tabId: 'test', agentDir: '/workspace', apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() };
    const tree = (active: boolean) => <TabApiContext.Provider value={api}><TabActiveContext.Provider value={active}><ContextMenu x={0} y={0} items={[{ label: 'Preview', onClick: vi.fn() }]} onClose={onClose} /></TabActiveContext.Provider></TabApiContext.Provider>;
    const view = render(tree(true));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeVisible();
    view.rerender(tree(false));
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

});

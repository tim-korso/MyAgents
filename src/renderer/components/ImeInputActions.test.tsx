import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import SessionRenameDialog from './SessionRenameDialog';
import PathInputDialog from './PathInputDialog';
import WhitelistManager from './ImSettings/components/WhitelistManager';
import BotTokenInput from './ImSettings/components/BotTokenInput';
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt';
import ChatSearchPanel from './ChatSearchPanel';
import ConfirmDialog from './ConfirmDialog';
import { Popover } from './ui/Popover';
import { usePanelKeys } from './task-center/editors/PanelChrome';

const imeEvents = [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }];

const inputCases: Array<{ name: string; view: (commit: ReturnType<typeof vi.fn>) => ReactNode; expected: unknown[] }> = [
  { name: 'Session rename', view: commit => <SessionRenameDialog currentTitle="Old" onConfirm={commit} onCancel={vi.fn()} />, expected: ['ceshi'] },
  { name: 'workspace path', view: commit => <PathInputDialog isOpen folderName="Docs" defaultPath="/tmp" onConfirm={commit} onCancel={vi.fn()} />, expected: ['ceshi'] },
  { name: 'whitelist addition', view: commit => <WhitelistManager users={[]} onChange={commit} />, expected: [['ceshi']] },
  { name: 'token field', view: commit => <BotTokenInput value="" onChange={commit} verifyStatus="idle" />, expected: ['ceshi'] },
  { name: 'custom question answer', view: commit => <AskUserQuestionPrompt request={{ requestId: 'q', questions: [{ id: 'answer', question: 'Text?', header: 'Text', options: [], multiSelect: false }] }} onSubmit={commit} onCancel={vi.fn()} />, expected: ['q', { answer: 'ceshi' }] },
];

describe.each(imeEvents)('text-input actions respect IME %j', ime => {
  it.each(inputCases)('$name commits only on a later deliberate Enter', async ({ view, expected, name }) => {
    const commit = vi.fn(async () => undefined);
    const { container } = render(view(commit));
    if (name === 'token field') fireEvent.click(container.querySelector('button')!);
    const input = screen.getByRole('textbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'ceshi' } });
    if (!ime.isComposing) fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', ...ime })).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(input).toHaveValue('ceshi');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, isComposing: false });
    await waitFor(() => expect(commit).toHaveBeenCalledWith(...expected));
  });

  it('does not navigate search matches or close the search panel during composition', () => {
    const next = vi.fn(), prev = vi.fn(), close = vi.fn();
    render(<ChatSearchPanel onClose={close} controller={{ query: 'ceshi', setQuery: vi.fn(), matchCount: 2, currentIndex: 0, next, prev, hasQuery: true, supported: true }} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', ...ime });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, ...ime });
    fireEvent.keyDown(input, { key: 'Escape', ...ime });
    expect(next).not.toHaveBeenCalled(); expect(prev).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(next).toHaveBeenCalledOnce();
  });
});

function PanelKeys({ submit, close }: { submit: () => void; close: () => void }) {
  usePanelKeys({ onSubmit: submit, onClose: close });
  return <input aria-label="Panel text" />;
}
function PopoverInput({ close }: { close: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return <><button ref={anchorRef}>Anchor</button><Popover open onClose={close} anchorRef={anchorRef}><input aria-label="Popover text" /></Popover></>;
}

describe.each(imeEvents)('ancestor/native keyboard actions respect IME %j', ime => {
  it('does not confirm a dialog when a mounted text input consumes Enter', () => {
    const confirm = vi.fn(), cancel = vi.fn();
    render(<><input aria-label="Underlying rename" /><ConfirmDialog title="Merge" message="Merge names?" onConfirm={confirm} onCancel={cancel} /></>);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', ...ime });
    fireEvent.keyDown(input, { key: 'Escape', ...ime });
    expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('does not submit or dismiss a Task editor from its document listener', () => {
    const submit = vi.fn(), close = vi.fn();
    render(<PanelKeys submit={submit} close={close} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, ...ime });
    fireEvent.keyDown(input, { key: 'Escape', ...ime });
    expect(submit).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 13 });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('keeps a generic input popover open while Escape cancels the IME candidate', () => {
    const close = vi.fn();
    render(<PopoverInput close={close} />);
    const input = screen.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'Escape', ...ime })).toBe(true);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 });
    expect(close).toHaveBeenCalledOnce();
  });
});

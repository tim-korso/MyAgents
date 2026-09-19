import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useImperativeHandle, useState, type Ref } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readPreview: vi.fn(), prepare: vi.fn(async () => true) }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({ useWorkspaceFileService: () => ({ isAvailable: true, readPreview: mocks.readPreview, checkPaths: async () => ({ results: { 'notes.md': { exists: true, type: 'file' } } }) }) }));
vi.mock('@/components/Toast', () => ({ useToastOptional: () => null }));
vi.mock('@/context/ImagePreviewContext', () => ({ useImagePreview: () => ({ openPreview: vi.fn() }) }));
vi.mock('@/components/FilePreviewModal', () => {
  function Draft({ content }: { content: string }) {
    const [text, setText] = useState(content);
    return <textarea aria-label="draft" value={text} onChange={event => setText(event.target.value)} />;
  }
  function MockPreview({ ref, content, isLoading, focusTarget }: { ref: Ref<unknown>; content: string; isLoading: boolean; focusTarget?: { requestId: number } }) {
    useImperativeHandle(ref, () => ({ prepareTransition: mocks.prepare }));
    return <div><output data-testid="focus">{focusTarget?.requestId}</output>{isLoading ? 'loading' : <Draft content={content} />}</div>;
  }
  return { default: MockPreview };
});
import { FileActionProvider, useFileLinkAction } from './FileActionContext';
function Open() {
  const actions = useFileLinkAction();
  return <button onClick={() => actions?.openFileLink('/workspace/notes.md#L2')}>locate note</button>;
}
describe('fallback preview document admission', () => {
  it('repeated same-document focus retains the mounted draft without a disk/loading replacement', async () => {
    mocks.readPreview.mockResolvedValue({ name: 'notes.md', content: 'disk', size: 4 });
    render(<FileActionProvider workspacePath="/workspace"><Open /></FileActionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'locate note' }));
    const draft = await screen.findByRole('textbox', { name: 'draft' });
    fireEvent.change(draft, { target: { value: 'unsaved local' } });
    const firstFocus = screen.getByTestId('focus').textContent;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'locate note' })));
    await waitFor(() => expect(screen.getByTestId('focus').textContent).not.toBe(firstFocus));
    expect(screen.getByRole('textbox', { name: 'draft' })).toBe(draft);
    expect(draft).toHaveValue('unsaved local');
    expect(mocks.readPreview).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

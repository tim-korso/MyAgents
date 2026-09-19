/**
 * Write plain text to the system clipboard.
 *
 * WebKit/WebView2 can expose Async Clipboard while rejecting writes because
 * of focus or permission state. A hidden selection + execCommand fallback is
 * still the broadest reliable user-gesture path across the desktop WebViews.
 * The promise resolves only after one path reports a real copy success.
 */
export async function copyPlainText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection fallback.
    }
  }
  if (copyPlainTextWithSelection(text)) return;
  throw new Error('Clipboard write is unavailable');
}

/** One clipboard item with rich and plain representations for the receiving app. */
export async function copyRichText(html: string | Promise<string>, text: string | Promise<string>): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': typeof html === 'string' ? new Blob([html], { type: 'text/html' }) : html.then(value => new Blob([value], { type: 'text/html' })),
        'text/plain': typeof text === 'string' ? new Blob([text], { type: 'text/plain' }) : text.then(value => new Blob([value], { type: 'text/plain' })),
      })]);
      return;
    } catch { /* Desktop WebViews may require the synchronous copy-event path. */ }
  }
  const [rich, plain] = await Promise.all([html, text]);
  if (copyRichTextWithEvent(rich, plain)) return;
  throw new Error('Rich clipboard write is unavailable');
}

/** Synchronous gesture fallback; no hidden focus/selection round-trip. */
function copyRichTextWithEvent(html: string, text: string): boolean {
  let wrote = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    // This action owns the payload; an editor's selection-copy handler must not replace it.
    event.stopImmediatePropagation();
    wrote = true;
  };
  document.addEventListener('copy', onCopy, true);
  try { return document.execCommand('copy') && wrote; }
  catch { return false; }
  finally { document.removeEventListener('copy', onCopy, true); }
}

function copyPlainTextWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const selection = window.getSelection?.();
  const previousRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      previousRanges.push(selection.getRangeAt(i).cloneRange());
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-10000px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (selection) {
      selection.removeAllRanges();
      for (const range of previousRanges) selection.addRange(range);
    }
    textarea.remove();
  }
}

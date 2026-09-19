// jsdom test (no JSX). jsdom doesn't implement URL.revokeObjectURL, so we
// install a mock (it exists in a real browser) and assert the scan revokes
// exactly the blob: URLs and nothing else.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revokeBlobUrls } from './docxBlobUrls';

const revoke = vi.fn();
beforeEach(() => {
  revoke.mockReset();
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revoke;
});

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('revokeBlobUrls', () => {
  it('revokes blob: URLs from [href] and <style> url(blob:…), plus the img', () => {
    const root = host(
      '<img src="blob:img-1">' +
        '<link href="blob:font-1">' +
        '<style>.a{background:url(blob:bg-1)} .b{src:url(blob:bg-2)}</style>',
    );
    revokeBlobUrls(root);
    const revoked = revoke.mock.calls.map((c) => c[0] as string);
    // href + style URLs come straight from the attribute/text (exact).
    expect(revoked).toEqual(expect.arrayContaining(['blob:font-1', 'blob:bg-1', 'blob:bg-2']));
    // 1 img + 1 href + 2 style = 4 revocations.
    expect(revoked).toHaveLength(4);
    expect(revoked.some((u) => u.startsWith('blob:'))).toBe(true);
  });

  it('ignores non-blob URLs (http / data / relative)', () => {
    const root = host(
      '<img src="https://x/a.png">' +
        '<link href="/local.css">' +
        '<style>.a{background:url(data:image/png;base64,AAA)}</style>',
    );
    revokeBlobUrls(root);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('is a no-op on an empty subtree', () => {
    revokeBlobUrls(host(''));
    expect(revoke).not.toHaveBeenCalled();
  });
});

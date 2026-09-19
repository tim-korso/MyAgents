// jsdom test (no JSX) — exercises the real DOM-neutralization guard. Lands in
// the `dom` vitest project via the .test.tsx suffix.
import { describe, expect, it } from 'vitest';

import { installExternalResourceGuard } from './externalResourceGuard';

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('installExternalResourceGuard — initial sweep', () => {
  it('blanks external img src but leaves blob:/data: URLs untouched', () => {
    const root = host(
      '<img id="ext" src="http://attacker/x.png">' +
        '<img id="blob" src="blob:abc">' +
        '<img id="data" src="data:image/png;base64,AAA">',
    );
    const dispose = installExternalResourceGuard(root);
    expect(root.querySelector('#ext')!.getAttribute('src')).toBe('');
    expect(root.querySelector('#blob')!.getAttribute('src')).toBe('blob:abc'); // embedded media untouched
    expect(root.querySelector('#data')!.getAttribute('src')).toBe('data:image/png;base64,AAA');
    dispose();
  });

  it('also blanks protocol-relative (//host) external references', () => {
    const root = host('<img id="p" src="//attacker/x.png">');
    installExternalResourceGuard(root);
    expect(root.querySelector('#p')!.getAttribute('src')).toBe('');
  });

  it('strips external url() from a <style> block, keeping the rest of the CSS', () => {
    const root = host('<style>.a{background:url(https://evil/x.png)} .b{color:red}</style>');
    installExternalResourceGuard(root);
    const css = root.querySelector('style')!.textContent!;
    expect(css).not.toContain('evil');
    expect(css).toContain('url()');
    expect(css).toContain('color:red');
  });

  it('leaves <a href> navigable but neutralizes resource-loading <link href>', () => {
    const root = host(
      '<a id="link" href="https://example.com">x</a>' +
        '<link id="css" rel="stylesheet" href="https://evil/x.css">',
    );
    installExternalResourceGuard(root);
    expect(root.querySelector('#link')!.getAttribute('href')).toBe('https://example.com');
    expect(root.querySelector('#css')!.getAttribute('href')).toBe('');
  });

  it('blanks a srcset that contains any external candidate', () => {
    const root = host('<img id="s" srcset="https://evil/a.png 1x, /local.png 2x">');
    installExternalResourceGuard(root);
    expect(root.querySelector('#s')!.getAttribute('srcset')).toBe('');
  });
});

describe('installExternalResourceGuard — MutationObserver (async-injected)', () => {
  it('neutralizes an external resource inserted AFTER install', async () => {
    const root = host('');
    const dispose = installExternalResourceGuard(root);
    const img = document.createElement('img');
    img.setAttribute('src', 'http://attacker/late.png');
    root.appendChild(img);
    // MutationObserver delivers on a microtask; flush a macrotask to be safe.
    await new Promise((r) => setTimeout(r, 0));
    expect(img.getAttribute('src')).toBe('');
    dispose();
  });

  it('stops neutralizing after dispose()', async () => {
    const root = host('');
    const dispose = installExternalResourceGuard(root);
    dispose();
    const img = document.createElement('img');
    img.setAttribute('src', 'http://attacker/after-dispose.png');
    root.appendChild(img);
    await new Promise((r) => setTimeout(r, 0));
    expect(img.getAttribute('src')).toBe('http://attacker/after-dispose.png'); // observer gone
  });
});

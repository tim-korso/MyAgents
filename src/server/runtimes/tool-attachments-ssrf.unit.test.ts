import { describe, expect, it } from 'vitest';

import { isUrlSchemeSafe } from './tool-attachments';

// SSRF red line: a prompt-injected tool must not be able to make the sidecar
// fetch internal metadata services or localhost-bound ports. isUrlSchemeSafe is
// the lexical guard (https-only + private/loopback/link-local host rejection).
const check = (url: string) => isUrlSchemeSafe(new URL(url));

describe('isUrlSchemeSafe — scheme', () => {
  it('allows https', () => {
    expect(check('https://example.com/a.png').ok).toBe(true);
  });
  it('rejects non-https schemes', () => {
    expect(check('http://example.com/a.png').ok).toBe(false);
    expect(check('ftp://example.com/a.png').ok).toBe(false);
    expect(check('file:///etc/passwd').ok).toBe(false);
  });
});

describe('isUrlSchemeSafe — private/loopback/link-local hosts', () => {
  it('rejects loopback', () => {
    expect(check('https://localhost/x').ok).toBe(false);
    expect(check('https://127.0.0.1/x').ok).toBe(false);
    expect(check('https://127.5.5.5/x').ok).toBe(false);
    expect(check('https://0.0.0.0/x').ok).toBe(false);
    expect(check('https://[::1]/x').ok).toBe(false);
  });

  it('rejects the cloud metadata endpoint (169.254.169.254) and link-local', () => {
    expect(check('https://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(check('https://169.254.0.1/x').ok).toBe(false);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(check('https://10.0.0.5/x').ok).toBe(false);
    expect(check('https://192.168.1.1/x').ok).toBe(false);
    expect(check('https://172.16.0.1/x').ok).toBe(false); // 172.16–172.31
    expect(check('https://172.31.255.255/x').ok).toBe(false);
  });

  it('rejects IPv6 ULA / link-local (fc00::/fd00::/fe80::)', () => {
    expect(check('https://[fc00::1]/x').ok).toBe(false);
    expect(check('https://[fd12::1]/x').ok).toBe(false);
    expect(check('https://[fe80::1]/x').ok).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 loopback (cross-review W1)', () => {
    // ::ffff:127.0.0.1 — Node normalizes to ::ffff:7f00:1 in hostname.
    expect(check('https://[::ffff:127.0.0.1]/x').ok).toBe(false);
    expect(check('https://[::ffff:7f00:1]/x').ok).toBe(false);
    // ::ffff:169.254.169.254 (metadata via mapped form)
    expect(check('https://[::ffff:169.254.169.254]/latest/meta-data/').ok).toBe(false);
  });

  it('rejects the IPv6 unspecified address (::) which can route to loopback', () => {
    expect(check('https://[::]/x').ok).toBe(false);
  });

  it('rejects decimal/hex IPv4 forms that normalize to loopback', () => {
    // Node's URL normalizes these back to 127.0.0.1, so the 127.* check catches them.
    expect(check('https://0x7f.0.0.1/x').ok).toBe(false);
    expect(check('https://2130706433/x').ok).toBe(false);
  });

  it('allows public hosts and public IPs', () => {
    expect(check('https://example.com/a.png').ok).toBe(true);
    expect(check('https://8.8.8.8/a.png').ok).toBe(true);
    // 172.32+ is public (outside the 172.16–172.31 private block).
    expect(check('https://172.32.0.1/x').ok).toBe(true);
  });
});

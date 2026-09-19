import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('integration no-egress guard', () => {
  it('blocks global fetch to non-loopback hosts before network I/O', () => {
    expect(() => fetch('https://example.com/no-egress')).toThrow('[test no-egress]');
  });

  it('blocks undici request surfaces to non-loopback hosts', async () => {
    const { Client, fetch: undiciFetch, request } = await import('undici');
    expect(() => undiciFetch('https://example.com/no-egress')).toThrow('[test no-egress]');
    expect(() => request('https://example.com/no-egress')).toThrow('[test no-egress]');
    expect(() => new Client('https://example.com')).toThrow('[test no-egress]');
  });

  it('blocks node builtin ESM network APIs to non-loopback hosts', async () => {
    const dns = await import('node:dns');
    const dnsPromises = await import('node:dns/promises');
    const http = await import('node:http');
    const net = await import('node:net');
    const tls = await import('node:tls');

    expect(() => dns.lookup('example.com', () => undefined)).toThrow('[test no-egress]');
    expect(() => dnsPromises.lookup('example.com')).toThrow('[test no-egress]');
    expect(() => http.get('http://example.com/no-egress')).toThrow('[test no-egress]');
    expect(() => net.connect(80, 'example.com')).toThrow('[test no-egress]');
    expect(() => new net.Socket().connect(80, 'example.com')).toThrow('[test no-egress]');
    expect(() => tls.connect(443, 'example.com')).toThrow('[test no-egress]');
  });

  it('blocks CJS require paths for node builtins', () => {
    const require = createRequire(import.meta.url);
    const http = require('node:http') as typeof import('node:http');
    const net = require('node:net') as typeof import('node:net');

    expect(() => http.get('http://example.com/no-egress')).toThrow('[test no-egress]');
    expect(() => net.createConnection(80, 'example.com')).toThrow('[test no-egress]');
  });
});

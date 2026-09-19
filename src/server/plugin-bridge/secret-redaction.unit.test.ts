import { describe, expect, it } from 'vitest';

import { redactPluginBridgeSecrets } from './secret-redaction';

describe('plugin bridge secret redaction', () => {
  it('redacts nested account config secrets before logging', () => {
    const redacted = redactPluginBridgeSecrets({
      accountId: 'default',
      appId: 'cli_public',
      appSecret: 'top-level-secret',
      config: {
        appId: 'cli_public',
        appSecret: 'nested-secret',
        clientSecret: 'nested-client-secret',
        token: 'nested-token',
        dmPolicy: 'open',
      },
    });

    expect(redacted).toEqual({
      accountId: 'default',
      appId: 'cli_public',
      appSecret: 'top-***',
      config: {
        appId: 'cli_public',
        appSecret: 'nest***',
        clientSecret: 'nest***',
        token: 'nest***',
        dmPolicy: 'open',
      },
    });
    expect(JSON.stringify(redacted)).not.toContain('nested-secret');
    expect(JSON.stringify(redacted)).not.toContain('nested-client-secret');
    expect(JSON.stringify(redacted)).not.toContain('nested-token');
  });

  it('redacts secret arrays and survives circular account objects', () => {
    const account: Record<string, unknown> = {
      tokens: ['first-token', 'second-token'],
    };
    account.self = account;

    expect(redactPluginBridgeSecrets(account)).toEqual({
      tokens: ['firs***', 'seco***'],
      self: '[Circular]',
    });
  });
});

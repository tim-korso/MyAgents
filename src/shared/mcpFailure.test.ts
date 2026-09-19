import { describe, expect, it } from 'vitest';
import { classifyMcpFailure } from './mcpFailure';

describe('MCP failure projection', () => {
  it.each([
    ['MCP initialization timed out', 'MCP_CONNECTION_TIMEOUT'],
    ['spawn /private/node ENOENT', 'MCP_RUNTIME_MISSING'],
    ['Cannot find module /private/package', 'MCP_PACKAGE_FAILED'],
    ["unknown option '--secret-argument'", 'MCP_CONFIG_INVALID'],
    ['connect ECONNREFUSED 127.0.0.1:1234', 'MCP_CONNECTION_FAILED'],
    ['HTTP 401 invalid token SECRET', 'MCP_NEEDS_AUTH'],
    ['unexpected response https://user:SECRET@example.invalid/private', 'MCP_STARTUP_FAILED'],
  ])('classifies %s without copying raw data', (message, expected) => {
    expect(classifyMcpFailure(message)).toBe(expected);
    expect(classifyMcpFailure(new Error(message))).toBe(expected);
  });

  it('accepts Codex failureReason and unknown older payloads', () => {
    expect(classifyMcpFailure(null, 'timeout')).toBe('MCP_CONNECTION_TIMEOUT');
    expect(classifyMcpFailure({ token: 'SECRET' })).toBe('MCP_STARTUP_FAILED');
    expect(classifyMcpFailure(undefined)).toBe('MCP_STARTUP_FAILED');
  });
});

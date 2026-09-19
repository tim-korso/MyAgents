import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  findExistingPath: vi.fn(),
  getBundledNodeDir: vi.fn(),
  getBundledRuntimePath: vi.fn(),
  getSystemNpxPaths: vi.fn(),
  getSystemNodeDirs: vi.fn(() => []),
}));

vi.mock('./runtime', () => runtimeMocks);

import { buildMcpStdioLaunchConfig, isMcpCommandAvailable, resolveNpxMcpInvocation } from './mcp-command';
import { testMcpServerConnection } from './mcp-connection-test';
import { projectManagedCodexMcpLaunchConfig } from '../runtimes/managed-codex/extensions/mcp-launch-projection';

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
}

function createWindowsNodeDistribution(root: string): {
  nodePath: string;
  npxPath: string;
  npxCliPath: string;
} {
  const nodePath = join(root, 'node.exe');
  const npxPath = join(root, 'npx.cmd');
  const npxCliPath = join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
  touch(nodePath);
  touch(npxPath);
  touch(npxCliPath);
  return { nodePath, npxPath, npxCliPath };
}

describe('resolveNpxMcpInvocation', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'myagents-npx-'));
    runtimeMocks.findExistingPath.mockReset().mockReturnValue(null);
    runtimeMocks.getBundledNodeDir.mockReset().mockReturnValue(null);
    runtimeMocks.getBundledRuntimePath.mockReset().mockReturnValue('node');
    runtimeMocks.getSystemNpxPaths.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('projects Windows system npx through node.exe and the absolute npx CLI entry', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const system = createWindowsNodeDistribution(join(testRoot, 'system-node'));
    runtimeMocks.getSystemNpxPaths.mockReturnValue([system.npxPath]);

    expect(resolveNpxMcpInvocation(['@playwright/mcp@0.0.68'])).toEqual({
      command: system.nodePath,
      args: [system.npxCliPath, '-y', '@playwright/mcp@0.0.68'],
      source: 'system',
    });
  });

  it('skips an incomplete Windows system shim and uses the complete bundled distribution', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const incompleteSystemNpx = join(testRoot, 'incomplete-system', 'npx.cmd');
    touch(incompleteSystemNpx);
    const bundled = createWindowsNodeDistribution(join(testRoot, 'bundled-node'));
    runtimeMocks.getSystemNpxPaths.mockReturnValue([incompleteSystemNpx]);
    runtimeMocks.getBundledNodeDir.mockReturnValue(dirname(bundled.nodePath));

    expect(resolveNpxMcpInvocation(['package-name', '--flag'])).toEqual({
      command: bundled.nodePath,
      args: [bundled.npxCliPath, '-y', 'package-name', '--flag'],
      source: 'bundled',
    });
  });

  it('fails closed on Windows when no complete Node and npx CLI pair exists', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const incompleteSystemNpx = join(testRoot, 'incomplete-system', 'npx.cmd');
    touch(incompleteSystemNpx);
    runtimeMocks.getSystemNpxPaths.mockReturnValue([incompleteSystemNpx]);

    expect(() => resolveNpxMcpInvocation(['package-name'])).toThrow(
      'No complete Windows Node.js distribution with npm/bin/npx-cli.js was found for MCP startup',
    );
  });

  it('keeps the direct absolute npx executable contract on non-Windows platforms', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    runtimeMocks.findExistingPath.mockReturnValue('/usr/local/bin/npx');
    runtimeMocks.getSystemNpxPaths.mockReturnValue(['/usr/local/bin/npx']);

    expect(resolveNpxMcpInvocation(['package-name', '-y'])).toEqual({
      command: '/usr/local/bin/npx',
      args: ['package-name', '-y'],
      source: 'system',
    });
  });

  it('moves the selected npx directory ahead of a competing Node for every launch surface', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    runtimeMocks.findExistingPath.mockReturnValue('/selected node/bin/npx');
    const launch = buildMcpStdioLaunchConfig({
      command: 'npx', args: ['example-mcp'], env: { MCP_SETTING: 'configured' },
    }, { executionEnv: { PATH: '/other/node:/selected node/bin:/usr/bin' } });
    expect(launch).toMatchObject({
      command: '/selected node/bin/npx', args: ['-y', 'example-mcp'],
      env: { PATH: '/selected node/bin:/other/node:/usr/bin', MCP_SETTING: 'configured' },
    });
  });

  it('keeps explicit server PATH authoritative and normalizes Windows casing', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const bundled = createWindowsNodeDistribution(join(testRoot, 'bundled'));
    runtimeMocks.getBundledNodeDir.mockReturnValue(dirname(bundled.nodePath));
    const launch = buildMcpStdioLaunchConfig({
      command: 'npx', args: ['example-mcp'], env: { PATH: 'C:\\chosen-node' },
    }, { executionEnv: { Path: 'C:\\other-node' } });
    expect(launch.command).toBe(bundled.nodePath);
    expect(launch.env.PATH).toBe('C:\\chosen-node');
    expect(launch.env).not.toHaveProperty('Path');
  });

  it('does not rewrite an explicitly configured executable or its arguments', () => {
    const launch = buildMcpStdioLaunchConfig({
      command: '/custom/bin/node', args: ['server.js'], env: { PATH: '/custom/bin' },
    }, { executionEnv: { PATH: '/base/bin' } });
    expect(launch).toMatchObject({
      command: '/custom/bin/node', args: ['server.js'], env: { PATH: '/custom/bin' },
    });
  });

  it('checks custom executables against their configured PATH and workspace', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    writeFileSync(join(testRoot, 'custom-mcp'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(testRoot, 'not-executable'), '');
    expect(isMcpCommandAvailable({ command: 'custom-mcp', env: { PATH: testRoot } })).toBe(true);
    expect(isMcpCommandAvailable({ command: './custom-mcp', env: { PATH: '/missing' } }, testRoot)).toBe(true);
    expect(isMcpCommandAvailable({ command: 'not-executable', env: { PATH: testRoot } })).toBe(false);
    expect(isMcpCommandAvailable({ command: 'custom-mcp', env: { PATH: '/missing' } })).toBe(false);
  });

  it('matches Windows spawn cwd lookup and quoted PATH directory handling', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    touch(join(testRoot, 'fixture.EXE'));
    expect(isMcpCommandAvailable({ command: 'fixture', env: { PATH: '/missing', PATHEXT: '.EXE' } }, testRoot)).toBe(true);
    expect(isMcpCommandAvailable({ command: 'fixture', env: { PATH: `"${testRoot}"`, PATHEXT: '.EXE' } }, '/missing')).toBe(true);
  });

  it('projects MCP PATH without changing the managed Runtime parent or allowing protected user env', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    runtimeMocks.findExistingPath.mockReturnValue('/selected/bin/npx');
    const parent = { PATH: '/other/bin:/selected/bin', HTTPS_PROXY: 'http://127.0.0.1:9999' };
    const server = { id: 'fixture', name: 'Fixture', type: 'stdio' as const,
      command: 'npx', args: ['example-mcp'], isBuiltin: false, env: { MCP_SETTING: 'value' } };
    const projection = projectManagedCodexMcpLaunchConfig([server], parent);
    expect(projection.failures).toEqual([]);
    const pathArg = projection.args.find(arg => arg.startsWith('mcp_servers.fixture.env='));
    expect(pathArg).toContain('PATH="/selected/bin:');
    expect(projection.envPatch).not.toHaveProperty('PATH');
    expect(projection.envPatch).not.toHaveProperty('Path');
    expect(parent.PATH).toBe('/other/bin:/selected/bin');
    expect(projectManagedCodexMcpLaunchConfig([{ ...server, env: { PATH: '/override' } }], parent)
      .failures).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('initializes an offline npx fixture with the selected Node despite a competing PATH node', async () => {
    const selectedDir = join(testRoot, 'selected node');
    const otherDir = join(testRoot, 'other');
    mkdirSync(selectedDir);
    mkdirSync(otherDir);
    symlinkSync(process.execPath, join(selectedDir, 'node'));
    writeFileSync(join(otherDir, 'node'), '#!/bin/sh\necho WRONG_NODE >&2\nexit 99\n', { mode: 0o755 });
    const fixture = join(testRoot, 'fixture.cjs');
    writeFileSync(fixture, `
      let buffer = '';
      process.stdin.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\\n')) >= 0) {
          const request = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (request.method === 'initialize') process.stdout.write(JSON.stringify({
            jsonrpc: '2.0', id: request.id, result: {
              protocolVersion: request.params.protocolVersion, capabilities: {},
              serverInfo: { name: process.execPath, version: process.env.MCP_SETTING }
            }
          }) + '\\n');
        }
      });
    `);
    const npx = join(selectedDir, 'npx');
    writeFileSync(npx, `#!/bin/sh\nexec node '${fixture.replace(/'/g, "'\\''")}'\n`, { mode: 0o755 });
    runtimeMocks.findExistingPath.mockReturnValue(npx);
    const server = { id: 'offline-npx', name: 'Offline npx', type: 'stdio' as const,
      command: 'npx', args: ['local-fixture-only'], isBuiltin: false,
      env: { HOME: testRoot, MCP_SETTING: 'configured' } };
    const result = await testMcpServerConnection(server, {
      executionEnv: { PATH: `${otherDir}:${selectedDir}:/usr/bin:/bin` }, cwd: testRoot,
    });
    expect(result).toMatchObject({ serverName: realpathSync(process.execPath), serverVersion: 'configured' });
  });
});

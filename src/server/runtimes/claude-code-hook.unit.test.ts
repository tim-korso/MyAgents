import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSessionStartHookCommand } from './claude-code';
import { spawn } from '../utils/subprocess';

describe('owned Claude Code SessionStart forwarder', () => {
  it('binds the forwarder to the Sidecar executable instead of PATH node', () => {
    expect(buildSessionStartHookCommand('/tmp/forwarder.cjs', 1234))
      .toBe(`'${process.execPath.replace(/'/g, "'\\''")}' '/tmp/forwarder.cjs' 1234`);
  });

  it('quotes paths as literal shell arguments, including apostrophes and expansions', () => {
    expect(buildSessionStartHookCommand("/Users/O'Brien/$(id)/`whoami`.cjs", 1234, '/App With Spaces/node'))
      .toBe("'/App With Spaces/node' '/Users/O'\\''Brien/$(id)/`whoami`.cjs' 1234");
  });

  it('uses Git Bash compatible Windows paths without changing the interpreter', () => {
    expect(buildSessionStartHookCommand('C:\\Users\\Name\\forwarder.cjs', 1234, 'C:\\Program Files\\MyAgents\\node.exe', 'win32'))
      .toBe("'C:/Program Files/MyAgents/node.exe' 'C:/Users/Name/forwarder.cjs' 1234");
  });

  it.skipIf(process.platform === 'win32')('runs the actual shell command without PATH node or shell expansion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'myagents-hook-'));
    try {
      const node = join(root, "node with ' $ and `quotes`");
      const script = join(root, "forwarder ' $(exit 19) `exit 20`.cjs");
      symlinkSync(process.execPath, node);
      writeFileSync(script, 'process.stdout.write(process.argv[2]);');
      const child = spawn(['/bin/sh', '-c', buildSessionStartHookCommand(script, 1234, node)], {
        env: { PATH: '/nonexistent', HOME: root }, stdout: 'pipe', stderr: 'pipe',
      });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(output).toBe('1234');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

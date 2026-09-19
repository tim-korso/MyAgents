import { expect, it } from 'vitest';
import { isContextInjectedSdkTool, toolPermissionGrantKey } from './sdk-tool-permission';

it('trusts only a host-registered and currently active context MCP', () => {
  const active = new Set(['im-bridge-tools']);
  expect(isContextInjectedSdkTool({ name: 'im-bridge-tools', source: 'sdk' }, active)).toBe(true);
  for (const source of ['plugin', 'project', 'dynamic', 'unknown']) {
    expect(isContextInjectedSdkTool({ name: 'im-bridge-tools', source }, active)).toBe(false);
  }
  expect(isContextInjectedSdkTool(undefined, active)).toBe(false);
  expect(isContextInjectedSdkTool({ name: 'im-bridge-tools', source: 'sdk' }, new Set())).toBe(false);
});

it('scopes MCP grants to provenance, preserving native tool grants', () => {
  const tool = 'mcp__foo_bar__read';
  const sources = [undefined, { name: 'foo.bar', source: 'sdk' },
    { name: 'foo.bar', source: 'plugin' }, { name: 'foo_bar', source: 'sdk' }];
  expect(new Set(sources.map(source => toolPermissionGrantKey(tool, source))).size).toBe(4);
  expect(toolPermissionGrantKey('Bash')).toBe('Bash');
});

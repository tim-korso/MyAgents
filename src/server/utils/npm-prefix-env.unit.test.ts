import { describe, expect, it } from 'vitest';

import {
  getMyAgentsNpmGlobalBinDir,
  getMyAgentsNpmGlobalPrefix,
  scrubMyAgentsNpmPrefixEnv,
} from './npm-prefix-env';

describe('npm prefix env utilities', () => {
  it('builds the MyAgents npm global prefix and bin dir per platform', () => {
    expect(getMyAgentsNpmGlobalPrefix('/Users/tester', 'darwin')).toBe('/Users/tester/.myagents/npm-global');
    expect(getMyAgentsNpmGlobalBinDir('/Users/tester', 'darwin')).toBe('/Users/tester/.myagents/npm-global/bin');

    expect(getMyAgentsNpmGlobalPrefix('C:\\Users\\tester', 'win32')).toMatch(/C:[/\\]Users[/\\]tester[/\\]\.myagents[/\\]npm-global/);
    expect(getMyAgentsNpmGlobalBinDir('C:\\Users\\tester', 'win32')).toMatch(/C:[/\\]Users[/\\]tester[/\\]\.myagents[/\\]npm-global/);
  });

  it('scrubs only npm prefix variables that point at the MyAgents prefix', () => {
    const prefix = '/Users/tester/.myagents/npm-global';
    const env: NodeJS.ProcessEnv = {
      npm_config_prefix: `${prefix}/`,
      NPM_CONFIG_PREFIX: '/Users/tester/.npm-global',
      PREFIX: prefix,
    };

    scrubMyAgentsNpmPrefixEnv(env, prefix, 'darwin');

    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.NPM_CONFIG_PREFIX).toBe('/Users/tester/.npm-global');
    expect(env.PREFIX).toBeUndefined();
  });
});

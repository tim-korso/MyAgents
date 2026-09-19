import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolvePluginUrl } from './url-resolver';

describe('resolvePluginUrl local paths', () => {
  it.runIf(process.platform === 'win32')(
    'parses Windows file URLs as native drive paths',
    () => {
      const result = resolvePluginUrl('file:///C:/Users/me/My%20Plugin');

      expect(result.kind).toBe('local');
      if (result.kind !== 'local') return;
      expect(result.absolutePath).toBe(resolvePath('C:\\Users\\me\\My Plugin'));
      expect(result.absolutePath).not.toContain('C:\\C:\\');
    },
  );

  it('serializes bare local paths with pathToFileURL', () => {
    const raw =
      process.platform === 'win32'
        ? 'C:\\Users\\me\\My Plugin'
        : '/tmp/My Plugin';
    const absolutePath = resolvePath(raw);
    const result = resolvePluginUrl(raw);

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') return;
    expect(result.absolutePath).toBe(absolutePath);
    expect(result.sourceUrl).toBe(pathToFileURL(absolutePath).href);
  });

  it('rejects parent segments across slash styles before disk access', () => {
    expect(() => resolvePluginUrl('C:\\Users\\me\\..\\secret')).toThrow();
    expect(() => resolvePluginUrl('file:///C:/Users/me/../secret')).toThrow();
    expect(() => resolvePluginUrl('file:///C:/Users/me/%2e%2e/secret')).toThrow();
  });
});

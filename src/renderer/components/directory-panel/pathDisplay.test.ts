import { describe, expect, it } from 'vitest';

import { getFolderName } from './pathDisplay';

describe('directory-panel pathDisplay', () => {
  it('extracts a display folder name across separators and trailing slashes', () => {
    expect(getFolderName('/Users/me/project/')).toBe('project');
    expect(getFolderName('C:\\Users\\me\\workspace')).toBe('workspace');
    expect(getFolderName('')).toBe('Workspace');
  });
});

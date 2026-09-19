import { describe, expect, it } from 'vitest';

import { shouldInstallMacFunctionKeyGuard } from './macFunctionKeyGuard';

describe('shouldInstallMacFunctionKeyGuard', () => {
  it('installs on macOS platforms only', () => {
    expect(shouldInstallMacFunctionKeyGuard('MacIntel')).toBe(true);
    expect(shouldInstallMacFunctionKeyGuard('MacPPC')).toBe(true);
    expect(shouldInstallMacFunctionKeyGuard('Win32')).toBe(false);
    expect(shouldInstallMacFunctionKeyGuard('Linux x86_64')).toBe(false);
  });
});

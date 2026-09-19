import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUpdater } from './useUpdater';

const mocks = vi.hoisted(() => ({ platform: 'linux-x86_64', invoke: vi.fn(), listen: vi.fn(), relaunch: vi.fn() }));
vi.mock('@/identity/deviceIdentity', () => ({ getPlatform: () => mocks.platform }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.4.17') }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: mocks.listen }));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/utils/debug', () => ({ isDebugMode: () => false }));
vi.mock('@/analytics', () => ({ track: vi.fn() }));
vi.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('Linux deb never checks, downloads, subscribes, or restarts for an update', async () => {
  mocks.platform = 'linux-x86_64';
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useUpdater());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(await result.current.checkForUpdate()).toBe('error');
    expect(await result.current.restartAndUpdate()).toBe('blocked');
  });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.relaunch).not.toHaveBeenCalled();
  expect(result.current.updateReady).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  unmount();
});

it.each(['darwin-aarch64', 'windows-x86_64'])('keeps background updates on %s', async platform => {
  mocks.platform = platform;
  vi.useFakeTimers();
  const { unmount } = renderHook(() => useUpdater());
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
  expect(mocks.invoke).toHaveBeenCalledWith('check_and_download_update');
  expect(mocks.listen).toHaveBeenCalled();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

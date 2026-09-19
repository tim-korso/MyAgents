import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleQrCodeAssetRoute } from './qr-code-asset';

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const logger = {
  log: vi.fn(),
  warn: vi.fn(),
};

const tempDirs: string[] = [];

function createTempCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'myagents-qr-route-test-'));
  tempDirs.push(dir);
  return dir;
}

function createQrRequest(method = 'GET'): Request {
  return new Request('http://local/api/assets/qr-code', { method });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('handleQrCodeAssetRoute', () => {
  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for unrelated routes', async () => {
    const response = await handleQrCodeAssetRoute(
      '/api/other',
      new Request('http://local/api/other'),
      { cacheDir: createTempCacheDir(), logger },
    );

    expect(response).toBeNull();
  });

  it('does not turn optional CDN failure into an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const response = await handleQrCodeAssetRoute(
      '/api/assets/qr-code',
      createQrRequest(),
      { cacheDir: createTempCacheDir(), fetchImpl, logger },
    );

    expect(response?.status).toBe(200);
    expect(await readJson(response as Response)).toEqual({
      success: false,
      error: 'QR code not available',
    });
  });

  it('serves stale cache when refresh download fails', async () => {
    const cacheDir = createTempCacheDir();
    writeFileSync(join(cacheDir, 'feedback_qr_code.png'), jpegBytes);
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const response = await handleQrCodeAssetRoute(
      '/api/assets/qr-code',
      createQrRequest(),
      { cacheDir, cacheMaxAgeMs: 0, fetchImpl, logger },
    );
    const body = await readJson(response as Response);

    expect(response?.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  (process.platform === 'win32' ? it.skip : it)('does not read a symlinked cache file', async () => {
    const cacheDir = createTempCacheDir();
    const secretFile = join(createTempCacheDir(), 'secret.txt');
    writeFileSync(secretFile, 'not an image secret');
    symlinkSync(secretFile, join(cacheDir, 'feedback_qr_code.png'));
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const response = await handleQrCodeAssetRoute(
      '/api/assets/qr-code',
      createQrRequest(),
      { cacheDir, fetchImpl, logger },
    );
    const body = await readJson(response as Response);

    expect(response?.status).toBe(200);
    expect(body).toEqual({
      success: false,
      error: 'QR code not available',
    });
  });

  it('stores downloaded image and reports the MIME type from bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(pngBytes));

    const response = await handleQrCodeAssetRoute(
      '/api/assets/qr-code',
      createQrRequest(),
      { cacheDir: createTempCacheDir(), fetchImpl, logger },
    );
    const body = await readJson(response as Response);

    expect(response?.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('serializes concurrent downloads through the shared cache lock', async () => {
    const cacheDir = createTempCacheDir();
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(pngBytes);
    });

    const [first, second] = await Promise.all([
      handleQrCodeAssetRoute('/api/assets/qr-code', createQrRequest(), { cacheDir, fetchImpl, logger }),
      handleQrCodeAssetRoute('/api/assets/qr-code', createQrRequest(), { cacheDir, fetchImpl, logger }),
    ]);

    const firstBody = await readJson(first as Response);
    const secondBody = await readJson(second as Response);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(firstBody.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(secondBody.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { BUILD_DOWNLOAD_TIMEOUT_MS, downloadBuildResource } from './build-resource-download.mjs';

const quiet = { maxBytes: 10, log() {}, sleep: async () => {} };

test('five-minute default covers every fresh attempt and retries a transient HTTP failure', async t => {
  assert.ok(BUILD_DOWNLOAD_TIMEOUT_MS >= 300_000);
  const timeouts = []; const signals = []; const delays = [];
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return new AbortController().signal; });
  const result = await downloadBuildResource('https://example.invalid/a', { ...quiet,
    sleep: async ms => delays.push(ms),
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      assert.equal(options.redirect, 'error');
      return signals.length === 1 ? new Response('busy', { status: 503 }) : new Response('ok');
    },
  });
  assert.equal(result.toString(), 'ok');
  assert.deepEqual(timeouts, [300_000, 300_000]);
  assert.notEqual(signals[0], signals[1]);
  assert.deepEqual(delays, [1000]);
});

test('transient transport errors stop after three attempts with actionable diagnostics', async () => {
  let calls = 0;
  await assert.rejects(downloadBuildResource('https://example.invalid/a', { ...quiet,
    fetchImpl: async () => { calls++; throw new TypeError('fetch failed'); },
  }), /example.invalid\/a.*attempt 3\/3.*300s/);
  assert.equal(calls, 3);
});

for (const status of [401, 403, 404]) {
  test(`HTTP ${status} fails immediately`, async () => {
    let calls = 0;
    await assert.rejects(downloadBuildResource('https://example.invalid/a', { ...quiet,
      fetchImpl: async () => { calls++; return new Response('no', { status }); },
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  });
}

test('oversized body is never retried', async () => {
  let calls = 0;
  await assert.rejects(downloadBuildResource('https://example.invalid/a', { ...quiet,
    fetchImpl: async () => { calls++; return new Response('too much data'); },
  }), /exceeds 10 bytes/);
  assert.equal(calls, 1);
});

test('real fetch body timeout retries the whole transfer, not just headers', async t => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(200); res.write('a');
    if (calls > 1) res.end('b');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const bytes = await downloadBuildResource(`http://127.0.0.1:${server.address().port}/slow`, {
    ...quiet, timeoutMs: 150,
  });
  assert.equal(bytes.toString(), 'ab');
  assert.equal(calls, 2);
});

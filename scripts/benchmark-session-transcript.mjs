// Synthetic, opt-in workload. Run: node --import tsx/esm scripts/benchmark-session-transcript.mjs
// --keep-fixtures retains only the generated temp directory for the Rust benchmark.
// --live-only isolates streaming memory from the 100 MiB cold-read workload;
// run with --expose-gc to report a collected baseline and retained heap.
import { mkdtemp, stat, rm, mkdir, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  createTranscriptProjection,
  applyTranscriptOperation,
} from "../src/shared/sessionTranscript.ts";
import { TranscriptFile } from "../src/server/session-transcript/file.ts";
import { TranscriptWriter } from "../src/server/session-transcript/writer.ts";
import { ProductTranscriptContent } from "../src/server/session-transcript/content.ts";
const root = await mkdtemp(join(tmpdir(), "myagents-v2-perf-"));
// Emits retained fixtures for the opt-in Rust index benchmark. The same
// searchable text and message boundaries are encoded through both formats.
if (process.argv.includes("--index-fixtures")) {
  const content = "history recovery partial output tool result user question response ".repeat(17000).slice(0, 1024 * 1024);
  for (const mib of [10, 100]) for (const version of [1, 2]) {
    const data = join(root, `v${version}-${mib}`);
    await mkdir(join(data, "sessions"), { recursive: true });
    await mkdir(join(data, "sessions-v2"));
    await writeFile(join(data, "sessions.json"), JSON.stringify([{
      id: "bench", agentDir: "/synthetic", title: "fixture",
      createdAt: "2026-09-12T00:00:00Z", lastActiveAt: "2026-09-12T00:00:00Z",
      ...(version === 2 ? { transcriptFormat: 2 } : {}),
    }]));
    const messages = Array.from({ length: mib }, (_, i) => ({
      id: String(i), role: "assistant", content, timestamp: "2026-09-12T00:00:00Z",
    }));
    const path = join(data, version === 1 ? "sessions/bench.jsonl" : "sessions-v2/bench.jsonl");
    if (version === 1) {
      const file = await open(path, "wx");
      try { for (const message of messages) await file.writeFile(JSON.stringify(message) + "\n"); }
      finally { await file.close(); }
    } else {
      const projection = createTranscriptProjection();
      for (const message of messages) applyTranscriptOperation(projection, { kind: "message-create", message });
      const file = new TranscriptFile({ sessionId: "bench", filePath: path, generation: "g1", allowCreate: true, withLock: run => run() });
      await file.replace({ generation: "g1", revision: 0 }, projection, 0);
    }
    console.log(JSON.stringify({ mib, version, logBytes: (await stat(path)).size }));
  }
  console.log(JSON.stringify({ root, purpose: "MYAGENTS_TRANSCRIPT_INDEX_BENCH_DIR" }));
  process.exit(0);
}
const metrics = {
  root,
  platform: process.platform,
  node: process.version,
  cold: [],
};
const makeFile = (id) =>
  new TranscriptFile({
    sessionId: id,
    filePath: join(root, id + ".jsonl"),
    generation: "g1",
    allowCreate: true,
    withLock: (run) => run(),
  });
for (const mib of process.argv.includes("--live-only") ? [] : [10, 100]) {
  const file = makeFile("cold" + mib),
    projection = createTranscriptProjection();
  for (let i = 0; i < mib; i++)
    applyTranscriptOperation(projection, {
      kind: "message-create",
      message: {
        id: "a" + i,
        role: "assistant",
        timestamp: "t",
        content: "x".repeat(1024 * 1024),
      },
    });
  const begin = performance.now();
  await file.replace({ generation: "g1", revision: 0 }, projection, 1);
  const baselineMs = performance.now() - begin;
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const loaded = await file.read();
    cold.push(performance.now() - start);
    if (loaded.projection.messages.size !== mib) throw Error("cold mismatch");
  }
  const row = {
    mib,
    bytes: (await stat(join(root, "cold" + mib + ".jsonl"))).size,
    baselineMs,
    coldMs: cold,
    p95: Math.max(...cold),
  };
  metrics.cold.push(row);
  console.log(JSON.stringify(row));
  if (row.p95 > (mib === 10 ? 500 : 3000)) throw Error("cold budget exceeded");
}
global.gc?.();
const memoryStart = process.memoryUsage();
let memoryPeak = { ...memoryStart };
const sessions = Array.from({ length: 4 }, (_, i) => {
  const id = "live" + i,
    file = makeFile(id),
    writer = new TranscriptWriter({
      sessionId: id,
      generation: "g1",
      revision: 0,
      projection: createTranscriptProjection(),
      storage: file,
    });
  const content = new ProductTranscriptContent(writer);
  content.admitUser({ id: "u1", role: "user", timestamp: "t", content: "u1" });
  const target = content.block("text", "text", { text: "" });
  return { file, writer, content, target, maxQueue: 0 };
});
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
const admissions = [];
const liveStarted = performance.now();
for (let tick = 0; tick < 500; tick++) {
  for (const s of sessions) {
    const begin = performance.now();
    s.content.append(s.target, "text", "x".repeat(128));
    admissions.push(performance.now() - begin);
    if (tick === 100 || tick === 300) {
      s.content.admitUser({
        id: "u" + tick,
        role: "user",
        timestamp: "t",
        content: "steer",
      });
      s.target = s.content.block("text", "text", { text: "" });
    }
    if (tick === 200) {
      const t = s.content.startTool("large", "Read");
      s.content.confirmText(t, "result", "x".repeat(8 * 1024 * 1024));
      s.content.updateTool(t, { isLoading: false });
    }
    if (tick === 350) {
      s.content.startTool("parent", "Agent");
      const c = s.content.startTool("child", "Read", {}, "parent");
      s.content.confirmInput(c, { path: "/tmp/example" });
      s.content.confirmText(c, "result", "nested".repeat(1024));
      s.content.updateTool(c, { isLoading: false });
    }
    s.maxQueue = Math.max(s.maxQueue, s.writer.diagnostics.queuedBytes);
    if (s.writer.status.state !== "healthy")
      throw Error(
        "healthy workload lost queue " + JSON.stringify(s.writer.status),
      );
  }
  const currentMemory = process.memoryUsage();
  for (const key of Object.keys(memoryPeak))
    memoryPeak[key] = Math.max(memoryPeak[key], currentMemory[key]);
  await delay(20);
}
for (const s of sessions) {
  s.content.finishTurn("complete");
  if (!(await s.writer.flush(2000))) throw Error("failed to drain");
  const r = await s.file.read();
  if (r.revision !== s.writer.status.liveRevision)
    throw Error("revision mismatch");
  await s.writer.close();
}
lag.disable();
global.gc?.();
const memoryAfterDrain = process.memoryUsage();
admissions.sort((a, b) => a - b);
metrics.live = {
  durationMs: performance.now() - liveStarted,
  nominalInputDurationMs: 10000,
  maxQueue: sessions.map((s) => s.maxQueue),
  appendP95Ms: admissions[Math.floor(admissions.length * 0.95)],
  eventLoopP95Ms: lag.percentile(95) / 1e6,
  eventLoopMaxMs: lag.max / 1e6,
  memory: { isolated: process.argv.includes("--live-only"), collected: Boolean(global.gc),
    start: memoryStart, peak: memoryPeak, afterDrain: memoryAfterDrain },
  projectionJsonBytes: sessions.map(s => Buffer.byteLength(JSON.stringify([...s.writer.projection.messages.values()]))),
  queuedBytesAfterDrain: sessions.map(s => s.writer.diagnostics.queuedBytes),
  logBytes: await Promise.all(
    sessions.map((_, i) =>
      stat(join(root, "live" + i + ".jsonl")).then((s) => s.size),
    ),
  ),
};
console.log(JSON.stringify(metrics.live));
console.log(JSON.stringify(metrics, null, 2));
if (!process.argv.includes("--keep-fixtures"))
  await rm(root, { recursive: true, force: true });

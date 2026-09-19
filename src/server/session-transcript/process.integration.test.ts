import { fork } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { readTranscriptFile } from "./file";
import { withFileLock } from "../utils/file-lock";

describe("V2 physical process termination", () => {
  it.each(["committed", "partial", "candidate", "renamed", "published"])(
    "recovers a complete prefix when killed at %s",
    async (stage) => {
      const root = await mkdtemp(join(tmpdir(), "myagents-transcript-kill-"));
      const child = fork(
        fileURLToPath(new URL("./fixtures/crash-writer.ts", import.meta.url)),
        [root, stage],
        {
          execArgv: ["--import", "tsx/esm"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      const exit = once(child, "exit");
      let stderr = "";
      child.stderr!.on("data", (chunk) => {
        stderr += String(chunk);
      });
      try {
        await Promise.race([
          once(child, "message"),
          exit.then(() => {
            throw new Error(`Fixture exited before kill: ${stderr}`);
          }),
        ]);
        child.kill("SIGKILL");
        await exit;
        const restored = await readTranscriptFile(
          join(root, "session.jsonl"),
          "session",
        );
        if (stage === "renamed" || stage === "published") {
          expect([...restored.projection.messages.keys()]).toEqual(["fork-a"]);
          expect(restored.projection.messages.get("fork-a")?.content).toBe(
            "complete target baseline",
          );
        } else {
          const rows = [...restored.projection.messages.values()];
          expect(rows.map((row) => row.role)).toEqual([
            "user",
            "assistant",
            "user",
            "assistant",
            "user",
            "assistant",
          ]);
          expect(
            rows
              .filter((row) => row.role === "assistant")
              .map((row) => Array.isArray(row.content) && row.content[0].text),
          ).toEqual([1, 2, 3].map((i) => `unfinished answer ${i}🙂`));
        }
        expect(restored.tail).toBe(
          stage === "partial" ? "incomplete" : "clean",
        );
        if (stage === "published") {
          expect(
            JSON.parse(await readFile(join(root, "metadata.json"), "utf8"))
              .generation,
          ).toBe(restored.header.generation);
        }
        // A killed owner, including one killed inside rename publication, can
        // be reclaimed through the real shared lock policy without a stale wait.
        await expect(
          withFileLock(
            { lockPath: join(root, "session.lock"), timeoutMs: 1000 },
            async () => true,
          ),
        ).resolves.toBe(true);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exit;
        }
        await rm(root, { recursive: true, force: true });
      }
    },
    15_000,
  );
});

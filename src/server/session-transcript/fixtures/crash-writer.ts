// Real process fixture; only synthetic data under the parent test's temp root.
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTranscriptProjection } from "../../../shared/sessionTranscript";
import { ProductTranscriptContent } from "../content";
import { TranscriptFile } from "../file";
import { TranscriptWriter } from "../writer";
import { withFileLock } from "../../utils/file-lock";

const [root, stage] = process.argv.slice(2);
if (!root || !stage || !process.send)
  throw new Error("Test fixture requires a temp directory and IPC");
const path = join(root, "session.jsonl");
let publishingReplacement = false;
const stopAtBoundary = async () => {
  process.send!({ ready: true });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
};
const file = new TranscriptFile({
  sessionId: "session",
  filePath: path,
  generation: "g1",
  allowCreate: true,
  withLock: (run) =>
    withFileLock({ lockPath: join(root, "session.lock") }, run),
  prepareReplacement: async () => {
    if (stage === "candidate") await stopAtBoundary();
  },
  publishBirth: async (target) => {
    if (publishingReplacement && stage === "renamed") await stopAtBoundary();
    await writeFile(join(root, "metadata.json"), JSON.stringify(target));
    if (publishingReplacement && stage === "published") await stopAtBoundary();
  },
});
const writer = new TranscriptWriter({
  sessionId: "session",
  generation: "g1",
  revision: 0,
  projection: createTranscriptProjection(),
  storage: file,
});
const content = new ProductTranscriptContent(writer);
for (let i = 1; i <= 3; i++) {
  content.admitUser({
    id: `u${i}`,
    role: "user",
    timestamp: "t",
    content: `query ${i}`,
  });
  const target = content.block("text", "text", { text: "" });
  content.append(target, "text", `unfinished answer ${i}🙂`);
  if (!(await writer.flush(2000)))
    throw new Error("Fixture could not commit prefix");
}
const durable = writer.status;
await writer.close();
if (stage === "partial") {
  const handle = await open(path, "a");
  await handle.write('{"batch":{"id":"torn');
  await handle.sync();
  await stopAtBoundary();
} else if (stage === "committed") {
  await stopAtBoundary();
} else {
  publishingReplacement = true;
  const projection = createTranscriptProjection();
  projection.messages.set("fork-a", {
    id: "fork-a",
    role: "assistant",
    timestamp: "t",
    content: "complete target baseline",
  });
  await file.replace(
    { generation: durable.generation, revision: durable.durableRevision },
    projection,
    durable.liveRevision + 1,
  );
}

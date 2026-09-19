// Offline production RecordDetail media regression. Synthetic audio only; no capture or user data.
// node scripts/verify-record-media-theme.mjs webkit (or chrome)
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const repo = resolve(import.meta.dirname, "..");
const output = await mkdtemp(resolve(tmpdir(), "myagents-record-theme-"));
const engine = process.argv[2] ?? "webkit";
assert.ok(["webkit", "chrome"].includes(engine));
const entryId = resolve(repo, "src/renderer/__record_theme.tsx");
const apiId = resolve(repo, "src/renderer/__record_theme_api.ts");
const fixtureApi = `
export * from '/api/recording.ts';
export * from '/api/taskCenter.ts';
export const snapshot=()=>window.captureMode==='ready'?null:({recordId:'fixture',revision:2,generation:1,
 captureStatus:window.captureMode,startedAtWallTime:1700000000000,mediaDurationMs:75000,pausedWallMs:0,
 sources:['microphone','system'].map(track=>({track,label:track,format:{channels:1,sampleRate:48000}})),
 sourceActivity:[{track:'microphone',levelPercent:55,enabled:true},{track:'system',levelPercent:0,enabled:false}],warnings:[]});
export const recordGet=async()=>({id:'fixture',kind:'audio',title:'录音播放器 · 主题验证',tags:[],createdAt:1700000000000,
 updatedAt:1700000000000,archived:false,convertedTaskIds:[],revision:2,artifacts:window.mediaTimelines?['microphone','system'].map((track,i)=>({path:'audio/'+track+'.opus',captureTimeline:{spans:[{sourceStart:0,sourceEnd:1196000,recordStart:i?3155:2086,recordEnd:1196000+(i?3155:2086),quality:'clock',discontinuity:true}]}})):[],audio:{mediaDurationMs:75000,
 captureStatus:window.captureMode,transcriptionStatus:window.captureMode==='ready'?'ready':'live',
 diarizationStatus:'not_applicable',tracks:['microphone','system'],sizeBytes:0}});
export const recordingSnapshot=async()=>snapshot();
export const recordSpeechProjection=async()=>({diarization:null,transcript:window.focusFixtureCount?{
 schemaVersion:1,recordId:'fixture',projectionRevision:1,state:'recording_final',sampleRate:16000,
 provenance:{provider:'sherpa-onnx',modelPackRevision:'test',onnxRuntimeVersion:'test'},
 segments:Array.from({length:window.focusFixtureCount},(_,i)=>({segmentId:'focus-'+i,track:'microphone',
 startSample:(4+i/2)*16000,endSample:(4.4+i/2)*16000,text:'转写定位 '+i,revision:1}))}:null});
export const recordTimeline=async()=>({recordId:'fixture',revision:1,items:window.focusFixtureCount?[
 {type:'mark',markId:'focus-mark',mediaMs:2000,wallTime:1700000002000},
 ...Array.from({length:window.focusFixtureCount},(_,i)=>({type:'note',seq:i+1,noteId:'focus-note-'+i,
 anchorMediaMs:(3+i/2)*1000,startedAtWallTime:1700000000000,submittedAtWallTime:1700000003000,text:'笔记定位 '+i}))]:[]});
export const speechModelPackStatus=async()=>({usable:true});
export const recordMediaUrl=(_id,track)=>'/__record_tone.wav?track='+track;
export const recordingPause=async()=>{window.captureMode='paused';return snapshot()};
export const recordingResume=async()=>{window.captureMode='recording';return snapshot()};
export const recordingStop=async()=>{window.captureMode='ready';return {recordId:'fixture',revision:3,generation:1,
 captureStatus:'ready',mediaDurationMs:75000,sources:[],sourceActivity:[],warnings:[]}};
`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeRuntimeProvider} from './theme/ThemeRuntime';
import {themeRegistry} from './theme/registry';
import {ToastProvider} from './components/Toast';
import RecordDetail from './pages/RecordDetail';
import {i18n} from './i18n';
import './index.css';
await i18n.changeLanguage('zh-CN');
window.captureMode='recording';
function Fixture(){
 const [selection,setSelection]=useState({themeId:'myagents-light',appearanceMode:'dark'});
 const [generation,setGeneration]=useState(0);
 window.audit={themes:themeRegistry.getProductionIds(),set:(themeId,appearanceMode,mode)=>{
  window.captureMode=mode;setSelection({themeId,appearanceMode});setGeneration(x=>x+1);
 }};
 return <ThemeRuntimeProvider selection={selection}><ToastProvider>
 <div style={{height:'100vh'}}><RecordDetail key={generation} recordId="fixture" isActive /></div>
 </ToastProvider></ThemeRuntimeProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const tone = Buffer.alloc(44 + 16000 * 2 * 75);
tone.write("RIFF");
tone.writeUInt32LE(tone.length - 8, 4);
tone.write("WAVEfmt ", 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(16000, 24);
tone.writeUInt32LE(32000, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write("data", 36);
tone.writeUInt32LE(tone.length - 44, 40);
for (let i = 0; i < 16000 * 75; i++)
  tone.writeInt16LE(
    Math.round(4000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
    44 + 2 * i,
  );
const server = await createServer({
  configFile: resolve(repo, "vite.config.ts"),
  cacheDir: resolve(output, "vite-cache"),
  optimizeDeps: {
    exclude: [
      "chartjs-umd-source",
      "d3-umd-source",
      "lucide-umd-source",
      "chartjs-umd-source?raw",
      "d3-umd-source?raw",
      "lucide-umd-source?raw",
    ],
  },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "record-theme-fixture",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "/__record_theme.tsx") return entryId;
        if (
          importer?.endsWith("/pages/RecordDetail.tsx") &&
          /(?:api\/recording|api\/taskCenter)(?:\.ts)?$/.test(id)
        )
          return apiId;
        if (/(?:^|\/)hooks\/useConfig(?:\.ts)?$/.test(id))
          return "\0record-config-fixture";
        if (
          importer?.endsWith("/pages/RecordDetail.tsx") &&
          /(?:^|\/)analytics$/.test(id)
        )
          return "\0record-analytics-fixture";
      },
      load(id) {
        if (id === entryId) return entry;
        if (id === apiId) return fixtureApi;
        if (id === "\0record-config-fixture")
          return "export const useConfig=()=>({config:{},projects:[],updateConfig:async()=>{}});";
        if (id === "\0record-analytics-fixture")
          return 'export const track=()=>{};export const hashPrivateIdentity=async()=>"fixture";';
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith("/__record_tone.wav")) {
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2]
              ? Math.min(Number(range[2]), tone.length - 1)
              : tone.length - 1;
            res.setHeader("Content-Type", "audio/wav");
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", end - start + 1);
            if (range) {
              res.statusCode = 206;
              res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${tone.length}`,
              );
            }
            res.end(tone.subarray(start, end + 1));
            return;
          }
          if (req.url !== "/__record_theme") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await vite.transformIndexHtml(
              req.url,
              '<html><body style="margin:0"><div id="root"></div><script type="module" src="/__record_theme.tsx"></script></body></html>',
            ),
          );
        });
      },
    },
  ],
});
let browser;
let page;
try {
  await server.listen();
  browser = await (engine === "webkit" ? webkit : chromium).launch({
    headless: true,
    ...(engine === "chrome" ? { channel: "chrome" } : {}),
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 920 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.goto(server.resolvedUrls.local[0] + "__record_theme");
  await page.waitForFunction(() => window.audit?.themes.length === 9);
  const results = [];
  for (const theme of await page.evaluate(() => window.audit.themes)) {
    for (const scheme of ["light", "dark"]) {
      for (const mode of ["recording", "paused", "ready"]) {
        await page.evaluate(
          ([themeId, appearance, state]) =>
            window.audit.set(themeId, appearance, state),
          [theme, scheme, mode],
        );
        const controls = page.getByTestId("record-media-controls");
        await controls.waitFor();
        await page.waitForFunction(
          ([id, color]) =>
            document.documentElement.dataset.themeId === id &&
            document.documentElement.dataset.colorScheme === color,
          [theme, scheme],
        );
        const result = await controls.evaluate((element) => {
          const style = getComputedStyle(element);
          const rgb = style.backgroundColor
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
          return {
            background: style.backgroundColor,
            foreground: style.color,
            maxChannel: Math.max(...rgb),
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        });
        assert.ok(
          result.maxChannel < 100,
          `${theme}.${scheme}.${mode}: media inverted ${JSON.stringify(result)}`,
        );
        assert.ok(
          result.scrollWidth <= result.width + 1,
          "media controls overflow",
        );
        if (mode !== "ready") {
          const stop = page.getByRole("button", { name: "停止并保存", exact: true });
          assert.equal(await stop.evaluate(e => getComputedStyle(e).color), "rgb(255, 255, 255)");
          assert.equal(await stop.locator("svg").evaluate(e => getComputedStyle(e).fill), "rgb(255, 255, 255)");
        }
        if (mode === "ready") {
          const slider = page.getByRole("slider", { name: "音量" });
          await slider.focus();
          assert.notEqual(
            await slider
              .locator("..")
              .evaluate((e) => getComputedStyle(e).outlineStyle),
            "none",
          );
          await page.getByRole("button", { name: "音轨", exact: true }).click();
          await page
            .getByRole("button", { name: "系统声音", exact: true })
            .click();
          assert.match(
            await page
              .getByRole("button", { name: "音轨", exact: true })
              .innerText(),
            /系统声音/,
          );
        }
        results.push({ theme, scheme, mode, ...result });
        if (theme === "myagents-light")
          await page.screenshot({
            path: resolve(output, `${scheme}-${mode}.png`),
          });
      }
    }
  }
  // Exercise real decoding, not just a moving UI clock. This tone used to
  // produce zero output while repeated seeks kept the progress moving.
  await page.evaluate(() => {
    window.mediaTimelines = true;
    window.audit.set("myagents-light", "dark", "ready");
  });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.themeId === "myagents-light" &&
      document.querySelectorAll("audio").length === 2,
  );
  await page
    .getByTestId("recording-primary-audio")
    .waitFor({ state: "attached" });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("audio")].every((a) => a.readyState >= 1),
  );
  await page.evaluate(() => {
    const context = new AudioContext();
    window.mediaAudit = { context, probes: [], seeks: 0, events: [] };
    for (const audio of document.querySelectorAll("audio")) {
      const analyser = context.createAnalyser();
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      window.mediaAudit.probes.push(analyser);
      audio.addEventListener("seeking", () => window.mediaAudit.seeks++);
      for (const event of [
        "play",
        "playing",
        "pause",
        "seeking",
        "seeked",
        "waiting",
      ]) {
        audio.addEventListener(event, () => {
          window.mediaAudit.events.push({
            event,
            src: audio.src.split("?")[1],
            time: audio.currentTime,
            at: performance.now(),
            muted: audio.muted,
          });
        });
      }
    }
    document.addEventListener(
      "click",
      () => {
        void context.resume();
      },
      { once: true },
    );
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() =>
    window.mediaAudit.probes.every((probe) => {
      const data = new Float32Array(probe.fftSize);
      probe.getFloatTimeDomainData(data);
      return data.some((value) => Math.abs(value) > 0.01);
    }),
  );
  await page.waitForFunction(
    () => document.querySelector("audio").currentTime > 1,
  );
  const playing = await page.evaluate(() => ({
    seeks: window.mediaAudit.seeks,
    times: [...document.querySelectorAll("audio")].map(
      (audio) => audio.currentTime,
    ),
  }));
  assert.ok(playing.seeks < 8, `seek storm: ${JSON.stringify(playing)}`);
  assert.ok(
    Math.abs(playing.times[0] + 0.130375 - (playing.times[1] + 0.1971875)) <
      0.2,
    "mixed sources lost synchronization",
  );
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  assert.ok(
    await page
      .locator("audio")
      .evaluateAll((elements) => elements.every((audio) => audio.paused)),
  );
  const progress = page
    .getByTestId("recording-playback-progress")
    .locator("input");
  const setRange = (locator, value) =>
    locator.evaluate((input, next) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  await setRange(progress, 40000);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("audio").currentTime > 40.3,
  );
  await page.waitForFunction(() =>
    window.mediaAudit.probes.every((probe) => {
      const data = new Float32Array(probe.fftSize);
      probe.getFloatTimeDomainData(data);
      return data.some((value) => Math.abs(value) > 0.01);
    }),
  );
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await page.getByRole("button", { name: "音轨", exact: true }).click();
  await page.getByRole("button", { name: "麦克风", exact: true }).click();
  assert.equal(await page.locator("audio").count(), 1);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector("audio").paused &&
      document.querySelector("audio").currentTime > 40.5,
  );
  await setRange(page.getByRole("slider", { name: "音量" }), 0);
  assert.equal(
    await page.locator("audio").evaluate((audio) => audio.volume),
    0,
  );
  await setRange(page.getByRole("slider", { name: "音量" }), 1);
  await setRange(progress, 74500);
  await page.waitForFunction(
    () =>
      document.querySelector("audio").paused &&
      Number(
        document.querySelector(
          '[data-testid="recording-playback-progress"] input',
        ).value,
      ) >= 74999,
  );
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector("audio");
    return !audio.paused && audio.currentTime > 0.2 && audio.currentTime < 5;
  });
  await page.screenshot({ path: resolve(output, "dark-playing.png") });
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await page.evaluate(() => window.mediaAudit.context.close());
  // Real native keyboard activation, including virtualized list focus after mounting.
  for (const count of [1, 120]) {
    await page.evaluate((size) => {
      window.focusFixtureCount = size;
      window.mediaTimelines = false;
      window.audit.set("myagents-light", "dark", "ready");
    }, count);
    const text = page.getByRole("button", { name: "转写定位 0", exact: true });
    await text.waitFor();
    const assertTransportFocus = async () => {
      // Let delayed list layout/focus callbacks settle as well.
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.getByTestId("record-media-controls")
        .getByRole("button", { name: /^(播放|暂停播放)$/ })
        .evaluate(e => e === document.activeElement), true);
    };
    const waitPlaying = (playing) => page.waitForFunction(expected =>
      [...document.querySelectorAll("audio")].every(a => a.paused !== expected), playing);
    await text.click();
    await assertTransportFocus();
    await waitPlaying(false); // Seek preserves paused intent.
    await page.keyboard.press("Space");
    await waitPlaying(true);
    await page.keyboard.press("Space");
    await waitPlaying(false);
    const timestamp = text.locator("xpath=ancestor::article").getByRole("button", { name: "00:04", exact: true });
    await timestamp.focus();
    await page.keyboard.press("Enter");
    await assertTransportFocus();
    await waitPlaying(false);
    await page.keyboard.press("Enter");
    await waitPlaying(true);
    await page.keyboard.press("Enter");
    await waitPlaying(false);
    await page.keyboard.press("Space");
    await waitPlaying(true);
    await text.click(); // Seek also preserves playing intent.
    await assertTransportFocus();
    await waitPlaying(true);
    await page.keyboard.press("Space");
    await waitPlaying(false);
    for (const key of ["mark-focus-mark", "note-focus-note-0"]) {
      const row = page.getByTestId(`recording-timeline-${key}`);
      await row.getByRole("button", { name: /跳转/ }).click();
      await assertTransportFocus();
    }
    await page.getByRole("button", { name: "笔记定位 0", exact: true }).click();
    await assertTransportFocus();
    const seek = page.getByTestId("recording-playback-progress").locator("input");
    await seek.focus();
    const before = Number(await seek.inputValue());
    await page.keyboard.press("ArrowRight");
    assert.ok(Number(await seek.inputValue()) > before);
    await page.keyboard.press("Space");
    await waitPlaying(true);
    await page.keyboard.press("Space");
    await waitPlaying(false);
    const note = page.getByTestId("recording-timeline-note-focus-note-0");
    await note.hover();
    await note.getByRole("button", { name: /更多/ }).click();
    await page.getByRole("button", { name: "编辑笔记", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "编辑笔记", exact: true });
    await composer.fill("笔记");
    await page.keyboard.press("Space");
    assert.equal(await composer.inputValue(), "笔记 ");
    await waitPlaying(false);
    await page.getByRole("button", { name: "音轨", exact: true }).focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "麦克风", exact: true }).waitFor();
    await waitPlaying(false);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify({
      engine,
      states: results.length,
      playback: "mixed, seek, pause, track, volume, ended, replay, native keyboard, virtualized seek focus",
      output,
    }),
  );
} catch (error) {
  if (page)
    console.error(
      await page
        .evaluate(() => ({
          context: window.mediaAudit?.context.state,
          events: window.mediaAudit?.events.slice(-45),
          progress: document.querySelector(
            '[data-testid="recording-playback-progress"] input',
          )?.value,
          audio: [...document.querySelectorAll("audio")].map((a) => ({
            time: a.currentTime,
            paused: a.paused,
            seeking: a.seeking,
            ready: a.readyState,
            muted: a.muted,
            error: a.error?.code,
            seekable: Array.from({ length: a.seekable.length }, (_, i) => [
              a.seekable.start(i),
              a.seekable.end(i),
            ]),
          })),
        }))
        .catch(() => null),
    );
  throw error;
} finally {
  await browser?.close();
  await server.close();
}

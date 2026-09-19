// Real browser regression for the pinned CM view repair. Deliberately no app
// CSS, Markdown parser, live projection or mocked geometry. Run with a bundled
// Playwright browser, or pass a locally installed channel: npm run verify:markdown-resize -- chrome
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { patchCodeMirrorView } from './patch-codemirror-view.mjs';
import { resolve } from 'node:path';

patchCodeMirrorView(resolve(import.meta.dirname, '../node_modules/@codemirror/view'), true);
const { outputFiles } = await build({
  stdin: { contents: `import {EditorView} from '@codemirror/view';
    window.view = new EditorView({doc:' $x'.repeat(8000),parent:document.body,
      extensions:[EditorView.lineWrapping,EditorView.theme({'&':{height:'826px',width:'390px'},'.cm-scroller':{overflow:'auto'}})]});`,
  resolveDir: resolve(import.meta.dirname, '..') },
  bundle: true, write: false, platform: 'browser', format: 'iife',
});
const browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { channel: process.argv[2] } : {}) });
const deadline = setTimeout(() => { void browser.close(); }, 30000);
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.setContent('<!doctype html><body style="margin:0"></body>');
  await page.addScriptTag({ content: outputFiles[0].text });
  for (const [width, ratio] of [[390, .3], [390, .7], [390, 1], [250, 1], [600, .3]]) {
    await page.evaluate(width => { window.view.dom.style.width = `${width}px`; }, width);
    await page.waitForTimeout(150);
    await page.evaluate(ratio => { const s = window.view.scrollDOM; s.scrollTop = (s.scrollHeight - s.clientHeight) * ratio; }, ratio);
    await page.waitForTimeout(300);
    const samples = await page.evaluate(() => {
      const view = window.view, bounds = view.scrollDOM.getBoundingClientRect();
      return Array.from({ length: 10 }, (_, index) => {
        const y = bounds.top + 30 + index * (bounds.height - 60) / 9;
        const position = view.posAtCoords({ x: bounds.left + 20, y });
        const rect = position === null ? null : view.coordsAtPos(position);
        return { y, position, top: rect?.top, bottom: rect?.bottom, tolerance: view.defaultLineHeight * 2 };
      });
    });
    for (const sample of samples) assert.ok(sample.top !== undefined && sample.y >= sample.top - sample.tolerance && sample.y <= sample.bottom + sample.tolerance,
      `Visible long-line gap at width ${width}, scroll ${ratio}: ${JSON.stringify(sample)}`);
  }
  console.log('CodeMirror resize: 5 resize/scroll states, 50 visible-coordinate round trips passed.');
} finally { clearTimeout(deadline); await browser.close(); }

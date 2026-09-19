// Real pointer hit-testing against production table CSS; jsdom cannot detect hover gaps.
// Optional installed browser channel: node scripts/verify-markdown-table-actions.mjs chrome
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const css = await readFile(new URL('../src/renderer/components/Markdown.css', import.meta.url), 'utf8');
const editorCss = await readFile(new URL('../src/renderer/components/markdown-editor/markdownEditor.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { channel: process.argv[2] } : {}) });
const deadline = setTimeout(() => { void browser.close(); }, 30000);
const actions = '<div class="markdown-table-actions"><span><button aria-label="Copy">C</button></span><span><button aria-label="Download">D</button></span></div>';
const table = '<table><tbody><tr><td>Alpha</td><td>Beta</td></tr><tr><td>Gamma</td><td>Delta</td></tr></tbody></table>';
function fixture(editor, compact = false) {
  return editor
    ? `<div class="md-editor-host"><div class="md-editor-shell"><div class="md-projection-Table"><div class="md-table-shell">${actions}<div class="md-table-scroll overflow-x-auto">${table}</div></div></div></div></div>`
    : `<div class="markdown-wide-surface"><div class="ai-message-content"><div class="markdown-content ${compact ? 'markdown-content--compact' : ''}"><div class="markdown-table"><div class="markdown-table-scroll overflow-x-auto">${table}</div>${actions}</div></div></div></div>`;
}
async function mount(page, editor, compact = false) {
  await page.setContent(`<!doctype html><style>
    * { box-sizing:border-box; } body { margin:0; padding:40px; }
    :root { --line:#ddd; --paper-elevated:white; --ink:#222; --ink-secondary:#555; }
    .ai-message-content,.md-editor-shell { width:600px; max-width:calc(100% - 104px); margin:auto; }
    table { border-collapse:collapse; min-width:100%; } td { padding:16px; }
    button { border:0; background:none; } .overflow-x-auto { overflow-x:auto; }
    .markdown-table-actions > span { display:inline-flex; }
  </style><style>${editorCss}</style><style>${css}</style>${fixture(editor, compact)}`);
}
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
  for (const [editor, width, compact] of [[false, 1200, false], [true, 1200, false], [false, 700, false], [true, 700, false], [false, 1200, true]]) {
    await page.setViewportSize({ width, height: 600 });
    await mount(page, editor, compact);
    const label = `${editor ? 'editor' : 'chat'} ${width}px${compact ? ' compact' : ''}`;
    const surface = page.locator(editor ? '.md-table-shell' : '.markdown-table');
    const toolbar = page.locator('.markdown-table-actions');
    const bounds = await surface.boundingBox();
    const control = await toolbar.boundingBox();
    const scroll = await page.locator(editor ? '.md-table-scroll' : '.markdown-table-scroll').boundingBox();
    assert.ok(bounds && control && scroll);
    await page.mouse.move(5, 5);
    assert.equal(await toolbar.evaluate(el => getComputedStyle(el).pointerEvents), 'none', `${label}: hidden at rest`);
    // Deliberately pause inside the gap. A fast jump directly onto the button masks the bug.
    const y = control.y + 16;
    await page.mouse.move(scroll.x + scroll.width - 10, y);
    const gapMidpoint = (scroll.x + scroll.width + control.x) / 2;
    await page.mouse.move(gapMidpoint, y, { steps: 6 });
    assert.equal(await surface.evaluate(el => el.matches(':hover')), true, `${label}: hover lost in gap`);
    assert.equal(await toolbar.evaluate(el => getComputedStyle(el).pointerEvents), 'auto', `${label}: gap disables actions`);
    // Test both copy and download rows, including returning through the gap.
    for (const button of await toolbar.locator('button').all()) {
      const box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
      assert.equal(await button.evaluate(el => el.matches(':hover')), true, `${label}: cannot reach button`);
      await page.mouse.move(gapMidpoint, box.y + box.height / 2, { steps: 6 });
      assert.equal(await surface.evaluate(el => el.matches(':hover')), true, `${label}: return gap loses hover`);
    }
    await page.mouse.move(5, 5);
    assert.equal(await toolbar.evaluate(el => getComputedStyle(el).pointerEvents), 'none', `${label}: hides on exit`);
    await page.keyboard.press('Tab');
    assert.equal(await toolbar.evaluate(el => getComputedStyle(el).pointerEvents), 'auto', `${label}: keyboard focus reveals actions`);
    assert.equal(await surface.evaluate(el => el.matches(':focus-within')), true);
    assert.equal((await surface.boundingBox()).width, bounds.width, `${label}: actions must not move layout`);
  }
  const touch = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 700, height: 600 } });
  await mount(touch, false);
  assert.equal(await touch.locator('.markdown-table-actions').evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'touch actions stay available');
  console.log('Table actions: wide chat/editor gap traversal, narrow/compact layouts, both buttons, exit, keyboard, touch and stable width passed.');
} finally { clearTimeout(deadline); await browser.close(); }

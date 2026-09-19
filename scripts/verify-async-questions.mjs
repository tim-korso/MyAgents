// Offline browser smoke of the production Message/Markdown/question card.
// Native runtime admission is covered by external-session-mock.integration.test.ts.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

const repo = resolve(import.meta.dirname, '..');
const output = await mkdtemp(resolve(tmpdir(), 'myagents-questions-verification-'));
const engine = process.argv[2] ?? 'webkit';
assert.ok(['webkit', 'chrome', 'chromium'].includes(engine));
const entryId = repo + '/src/renderer/__questions_audit.tsx';
const entry = `import React,{useState,useRef,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {i18n} from './i18n';
import {ThemeRuntimeProvider} from './theme/ThemeRuntime';
import {ImagePreviewProvider} from './context/ImagePreviewContext';
import {AsyncQuestionContext} from './context/AsyncQuestionContext';
import {AsyncQuestionComposerTarget} from './components/AsyncQuestionCard';
import Message from './components/Message';
import './index.css';
await i18n.changeLanguage('zh-CN');
const questions={id:'q',questions:[{title:'周末想去哪里？',options:['看海','爬山']},{title:'还有什么安排？',options:null}]};
const message={id:'assistant',role:'assistant',timestamp:new Date(),content:[
 {type:'text',text:'可以选择一个目的地，也可以自由回答。',isComplete:true},
 {type:'text',text:'',asyncQuestions:questions,isComplete:true},
 {type:'text',text:'我会继续准备行程。',isComplete:true}]};
function Fixture(){
 const [queued,setQueued]=useState([]),[answered,setAnswered]=useState([]),[target,setTarget]=useState(null);
 const input=useRef(null),receipt=useRef(null),calls=useRef([]);
 useLayoutEffect(()=>{window.audit={setQueued,setAnswered,calls,resolve:value=>receipt.current(value)}});
 const actions={queued,answered,disabled:false,onReply:(reply,text)=>{calls.current.push({reply,text});return new Promise(done=>receipt.current=done)},onCompose:(reply,title)=>{setTarget({reply,title});input.current.focus()}};
 return <main style={{maxWidth:720,margin:'20px auto',padding:12}}><AsyncQuestionContext.Provider value={actions}><Message message={message}/></AsyncQuestionContext.Provider>
 {target&&<AsyncQuestionComposerTarget title={target.title} onCancel={()=>setTarget(null)}/>}<textarea ref={input} aria-label="自由回答输入框" style={{width:'100%',border:'1px solid gray'}}/></main>;
}
createRoot(document.getElementById('root')).render(<ThemeRuntimeProvider selection={null}><ImagePreviewProvider><Fixture/></ImagePreviewProvider></ThemeRuntimeProvider>);`;
const server = await createServer({
  configFile: resolve(repo, 'vite.config.ts'),
  cacheDir: resolve(output, 'vite-cache'),
  optimizeDeps: { exclude: ['chartjs-umd-source', 'd3-umd-source', 'lucide-umd-source', 'chartjs-umd-source?raw', 'd3-umd-source?raw', 'lucide-umd-source?raw'] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'async-questions-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/__questions_audit.tsx') return entryId; },
    load(id) { if (id === entryId) return entry; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__questions_audit') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/__questions_audit.tsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 460, height: 780 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__questions_audit`);
  await page.getByRole('button', { name: '看海', exact: true }).click();
  await page.getByText('正在提交…', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '爬山', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.audit.setQueued([{ questionId: 'q', questionIndex: 0 }]); window.audit.resolve(true); });
  await page.getByText('等待发送', { exact: true }).waitFor();
  await page.evaluate(() => { window.audit.setQueued([]); window.audit.setAnswered([{ questionId: 'q', questionIndex: 0 }]); });
  await page.getByText('已回答', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '看海', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '自由回答', exact: true }).nth(1).click();
  assert.equal(await page.getByRole('textbox', { name: '自由回答输入框' }).evaluate(el => el === document.activeElement), true);
  await page.getByRole('textbox').fill('想看日落');
  await page.getByText('取消回答', { exact: true }).click();
  assert.equal(await page.getByRole('textbox').inputValue(), '想看日落');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => window.audit.calls.current.length), 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, `${engine}-answered.png`), fullPage: true });
  console.log(JSON.stringify({ engine, status: 'PASS', output }));
} finally {
  await browser?.close();
  await server.close();
}

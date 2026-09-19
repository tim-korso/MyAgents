// Offline #589 regression: real status panel -> input measurement -> chat spacer.
// node scripts/verify-agent-status-scroll.mjs webkit (or chrome)
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

const repo = resolve(import.meta.dirname, '..');
const output = await mkdtemp(resolve(tmpdir(), 'myagents-status-scroll-'));
const engine = process.argv[2] ?? 'webkit';
assert.ok(['webkit', 'chrome'].includes(engine));
const entryId = resolve(repo, 'src/renderer/__status_scroll_audit.tsx');
const entry = `
import React,{useState,useRef,useLayoutEffect,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeRuntimeProvider} from './theme/ThemeRuntime';
import {ToastProvider} from './components/Toast';
import {ImagePreviewProvider} from './context/ImagePreviewContext';
import {TabContext} from './context/TabContext';
import {ConfigDataContext} from './config/ConfigProvider';
import {DEFAULT_CONFIG} from './config/types';
import {i18n} from './i18n';
import MessageList from './components/MessageList';
import SimpleChatInput from './components/chat-input/SimpleChatInput';
import AgentStatusPanel from './components/agent-status/AgentStatusPanel';
import {useChatScrollModel} from './hooks/useChatScrollModel';
import {useChatScrollController} from './hooks/useChatScrollController';
import './index.css';
await i18n.changeLanguage('zh-CN');
const cold=new URLSearchParams(location.search).has('cold');
const mk=(id,content)=>({id,content,role:'assistant',timestamp:new Date(0)});
const history=Array.from({length:60},(_,i)=>mk('h'+i,'History paragraph. '.repeat(30)));
const text=Array(120).fill('A long final paragraph that must remain fully reachable. '.repeat(5)).join('\\n\\n');
const done=mk('tail',[{type:'tool_use',tool:{id:'todo',name:'TodoWrite',input:{},streamIndex:0,
parsedInput:{todos:[{content:'Finished task',status:'completed',activeForm:'Working'}]}}},{type:'text',text}]);
const noop=()=>{};
function Fixture(){
 const [live,setLive]=useState(!cold),[spacer,setSpacer]=useState(176);
 const rootRef=useRef(null);
 const model=useChatScrollModel({historyMessages:[...history,done],streamingMessage:null,sessionId:'fixture'});
 const ctrl=useChatScrollController({messages:model.data,isActive:true,sessionId:'fixture',rootRef});
 const reportHeight=useCallback(h=>setSpacer(Math.ceil(h)),[]);
 useLayoutEffect(()=>{window.audit={stop:()=>setLive(false),snapshot:()=>{
   const e=ctrl.scrollerRef.current,tail=e?.querySelector('[data-message-id="tail"]');
   return {top:e?.scrollTop,height:e?.scrollHeight,view:e?.clientHeight,
     tailBottom:tail?.getBoundingClientRect().bottom,spacer,
     panel:!!document.querySelector('[aria-label="展开 Agent 状态面板"]')};
 }}});
 return <TabContext.Provider value={{tabId:'fixture',sessionId:'fixture',sessionState:live?'running':'idle',
 messages:model.data,streamingMessage:live?done:null,agentPlanTodos:null}}>
 <div ref={rootRef} style={{height:640,width:760,display:'flex',flexDirection:'column',position:'relative',overflow:'hidden'}}>
 <MessageList messages={model.data} isLoading={false} sessionState="idle" isStreaming={false} sessionId="fixture"
 firstItemIndex={100000} heightEstimateSeed={model.heightEstimateSeed} layoutByMessageId={model.layoutByMessageId}
 virtuosoRef={ctrl.virtuosoRef} onScrollerRef={ctrl.attachScroller} followEnabledRef={ctrl.followEnabledRef}
 scrollToBottom={ctrl.scrollToBottom} handleAtBottomChange={ctrl.handleAtBottomChange}
 onViewportAdmissionChanged={ctrl.onViewportAdmissionChanged} onItemsRendered={ctrl.onItemsRendered}
 isViewportRecoveryFenced={ctrl.isViewportRecoveryFenced} onRowLayoutChanged={ctrl.onRowLayoutChanged} bottomSpacerPx={spacer}/>
 <SimpleChatInput onSend={noop} isLoading={false} sessionId="fixture" onOverlayHeightChange={reportHeight}
 agentStatusSlot={<AgentStatusPanel containerRef={rootRef} onJumpToTool={noop}/>}/>
 </div></TabContext.Provider>;
}
createRoot(document.getElementById('root')).render(<ThemeRuntimeProvider selection={null}><ConfigDataContext.Provider value={{config:DEFAULT_CONFIG}}><ToastProvider><ImagePreviewProvider><Fixture/></ImagePreviewProvider></ToastProvider></ConfigDataContext.Provider></ThemeRuntimeProvider>);
`;
const server = await createServer({
  configFile: resolve(repo, 'vite.config.ts'), cacheDir: resolve(output, 'vite-cache'),
  optimizeDeps: { exclude: ['chartjs-umd-source', 'd3-umd-source', 'lucide-umd-source',
    'chartjs-umd-source?raw', 'd3-umd-source?raw', 'lucide-umd-source?raw'] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'status-scroll-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/__status_scroll_audit.tsx') return entryId; },
    load(id) { if (id === entryId) return entry; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__status_scroll_audit') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<html><body style="margin:0"><div id="root"></div><script type="module" src="/__status_scroll_audit.tsx"></script></body></html>'));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true,
    ...(engine === 'chrome' ? { channel: 'chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 },
    recordVideo: { dir: output, size: { width: 1000, height: 800 } } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.continue() : route.abort();
  });
  const evidence = {};
  for (const mode of ['cold', 'live']) {
    await page.goto(server.resolvedUrls.local[0] + '__status_scroll_audit' + (mode === 'cold' ? '?cold' : ''));
    await page.waitForFunction(() => window.audit?.snapshot().tailBottom !== undefined);
    if (mode === 'live') {
      await page.waitForFunction(() => window.audit.snapshot().panel);
      await page.evaluate(() => window.audit.stop());
    }
    await page.waitForTimeout(2500); // complete the one allowed linger/fade
    const samples = await page.evaluate(() => new Promise(resolve => {
      const samples = [], until = performance.now() + 6500; // more than three old cycles
      function frame() {
        samples.push(window.audit.snapshot());
        if (performance.now() >= until) resolve(samples); else requestAnimationFrame(frame);
      }
      frame();
    }));
    evidence[mode] = samples;
    await writeFile(resolve(output, 'geometry.json'), JSON.stringify(evidence));
    assert.ok(samples.every(s => !s.panel), mode + ': completed panel remounted');
    assert.equal(new Set(samples.map(s => s.height)).size, 1, mode + ': idle scroll height changed');
    assert.equal(new Set(samples.map(s => s.top)).size, 1, mode + ': idle viewport moved');
    assert.ok(samples.every(s => Math.abs(s.height - s.view - s.top) <= 1), mode + ': bottom not reached');
    assert.ok(samples.every(s => s.tailBottom > 0 && s.tailBottom < s.view), mode + ': final text not visible');
    await page.mouse.move(360, 260);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
    const returned = await page.evaluate(() => window.audit.snapshot());
    assert.ok(Math.abs(returned.height - returned.view - returned.top) <= 1, mode + ': wheel cannot reach bottom');
  }
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Status panel scroll ' + engine + ': cold history, terminal completion, idle stability and tail reachability passed. Evidence: ' + output);
} finally {
  await browser?.close();
  await server.close();
}

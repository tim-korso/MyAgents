// Browser geometry regression using the production parser/projection and CSS.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compile } from '@tailwindcss/node';
const root = resolve(import.meta.dirname, '..');
const { outputFiles } = await build({ stdin: { resolveDir: root, contents: `
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection } from '@codemirror/view';
import { forceParsing } from '@codemirror/language';
import { markdownSyntax } from './src/renderer/components/markdown-editor/syntax';
import { definitions } from './src/renderer/components/markdown-editor/definitions';
import { livePreview, sourceBlock, focusedField, projectionHost, editorFocused } from './src/renderer/components/markdown-editor/livePreview';
window.mount = doc => {
 window.view?.destroy();
 const host = {mount(el,p,view) {
  el.style.removeProperty('min-height');
  if (p.kind === 'Table') { el.style.height = ((view.state.doc.lineAt(p.to).number-view.state.doc.lineAt(p.from).number)*35+18)+'px'; el.textContent='Rendered table'; }
  else if (p.kind === 'Image') { el.innerHTML='<span class="md-rendered-block"><span class="markdown-content"><p><img width="90" height="42" /></p></span></span>'; }
  else if (p.kind === 'InlineHTML') { el.innerHTML='<span class="md-rendered-block"><span class="markdown-content"><p>'+p.source+'</p></span></span>'; }
  else { el.textContent = p.kind; el.style.height='52px'; }
 },unmount() {}};
 window.view = new EditorView({parent:document.querySelector('.md-editor-host'),state:EditorState.create({doc,extensions:[markdownSyntax(), definitions,sourceBlock,focusedField,projectionHost.of(host),livePreview(),EditorView.lineWrapping,drawSelection(),EditorView.focusChangeEffect.of((s,f)=>editorFocused.of(f))]})});
 forceParsing(window.view,doc.length,5000);
};` }, bundle:true, write:false, platform:'browser',format:'iife' });
const stubs={
'useTauriFileDrop':`export const useTauriFileDrop=()=>({registerZone:()=>{},unregisterZone:()=>{}});`,
'useWorkspaceFileService':`const service={isAvailable:true,async readFileAsBlobUrl({path}){const src=window.imageFixtures[path];if(!src)throw Error('Missing fixture');await new Promise(resolve=>setTimeout(resolve,40));const blobUrl=URL.createObjectURL(await(await fetch(src)).blob());return {blobUrl,revoke(){URL.revokeObjectURL(blobUrl)}};}};export const useWorkspaceFileService=()=>service;`,
'BrowserPanelContext':`export const useOpenWebLink=()=>()=>{};`,
'fileActionState':`export const useFileLinkAction=()=>null,useFileAction=()=>null,useFileTargetInfo=()=>null;`,
'Toast':`export const useToast=()=>({error:console.error}),useToastOptional=()=>null;`,
'@/theme':`const theme={adapters:{prism:{}},resolvedColorScheme:'light'};export const useResolvedTheme=()=>theme;`
};
const reactBundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import './src/renderer/i18n';
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {EditorView} from '@codemirror/view';import {forceParsing} from '@codemirror/language';
import MarkdownEditor from './src/renderer/components/markdown-editor/MarkdownEditor';
window.view?.destroy();
const root=createRoot(document.querySelector('.md-editor-shell').parentElement); let key=0, source='', options={};
const render=()=>{flushSync(()=>root.render(<MarkdownEditor key={key} initialSource={source} path="README.md" sourceMode={false} allowImages={false} onChange={()=>{}} onSave={()=>{}} {...options} />));window.view=EditorView.findFromDOM(document.querySelector('.md-editor-host .cm-editor'));};
window.mount=(doc,parse=true)=>{source=doc;options={};key++;render();if(parse)forceParsing(window.view,doc.length,5000)};
window.setOptions=value=>{options=value;render()};
`},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty','.svg':'dataurl'},plugins:[{name:'host-stubs',setup(b){b.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(k=>args.path===k||args.path.endsWith('/'+k));if(key)return {path:key,namespace:'stub'}});b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});

const compiler=await compile(await readFile(resolve(root,'src/renderer/index.css'),'utf8'),{base:resolve(root,'src/renderer'),onDependency(){}});
const appCss=compiler.build(['overflow-x-auto','max-w-full','min-w-0','break-words','text-xs','italic','overflow-hidden','rounded-lg','border','border-[var(--line)]','bg-[var(--paper-elevated)]','shadow-xl']);
const themeCss=await readFile(resolve(root,'src/renderer/theme/themes/myagents-default.css'),'utf8');
let mathCss=await readFile(resolve(root,'node_modules/katex/dist/katex.min.css'),'utf8');
for(const font of new Set([...mathCss.matchAll(/url\((fonts\/[^)]+)\)/g)].map(match=>match[1]))) {
 const bytes=await readFile(resolve(root,'node_modules/katex/dist',font));
 const type=font.endsWith('.woff2')?'font/woff2':font.endsWith('.woff')?'font/woff':'font/ttf';
 mathCss=mathCss.replaceAll('url('+font+')','url(data:'+type+';base64,'+bytes.toString('base64')+')');
}
const markdownCss=await readFile(resolve(root,'src/renderer/components/Markdown.css'),'utf8');
const css = await readFile(resolve(root, 'src/renderer/components/markdown-editor/markdownEditor.css'),'utf8');
const browser = await (process.argv[2]==='webkit'?webkit:chromium).launch({headless:true,...(process.argv[2]==='chrome'?{channel:'chrome'}:{})});
try {
 const page = await browser.newPage({viewport:{width:900,height:700}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<style>:root{--font-body:Arial;--text-base:16px;--font-weight-prose:500;--text-2xl:22px;--text-xl:20px;--text-lg:18px;--text-2xl--line-height:30px;--text-xl--line-height:28px;--text-lg--line-height:27px}body{margin:0}.md-editor-shell{height:650px!important;width:650px}${css}</style><div class="md-editor-shell"><div class="md-editor-host"></div></div>`);
 await page.addScriptTag({content:outputFiles[0].text});
 const table='| A | B |\n| --- | --- |\n'+Array.from({length:300},(_,i)=>'| row '+i+' | text |').join('\n');
 await page.evaluate(doc=>window.mount(doc),Array.from({length:5},(_,i)=>'## Section '+i+'\n\n'+table+'\n\nAfter table '+i+'\n\n').join(''));
 await page.waitForTimeout(500);
 const heights=[];
 for (let i=0;i<14;i++) {
  await page.evaluate(()=>{window.view.scrollDOM.scrollTop+=450});
  await page.waitForTimeout(100);
  heights.push(await page.evaluate(()=>({height:window.view.contentHeight,scroll:window.view.scrollDOM.scrollTop,raw:[...document.querySelectorAll('.cm-line')].some(e=>e.textContent.startsWith('| row'))})));
 }

 assert.ok(heights.every(s=>!s.raw),'Long table fell back to raw source during scroll');
 assert.ok(Math.max(...heights.map(s=>s.height))-Math.min(...heights.map(s=>s.height))<100,'Scrolling changed document block topology/height');
 assert.ok(heights.at(-1).scroll>heights[0].scroll+4000,'Scrolling jumped backwards');
 assert.deepEqual(errors,[]);
 console.log('Live preview long table geometry passed.');
 await page.addStyleTag({content:appCss+'\n'+themeCss+'\n'+markdownCss+'\n'+mathCss});
 await page.evaluate(()=>document.documentElement.dataset.colorScheme='light');
 await page.evaluate(()=>window.imageFixtures={});
 await page.addScriptTag({content:reactBundle.outputFiles[0].text});
 // Offline image bytes still complete asynchronously through the real renderer.
 await page.route('https://**/*',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28"><rect width="120" height="28" fill="gray"/></svg>'}));
 const realTables=Array.from({length:3},(_,i)=>'## Table '+i+'\n\n'+table+'\n\nAfter table '+i+'\n\n').join('');
 await page.evaluate(doc=>window.mount(doc),realTables); await page.waitForTimeout(700);
 for(let step=0;step<55;step++) {
  const before=await page.evaluate(()=>window.view.scrollDOM.scrollTop);
  await page.evaluate(()=>window.view.scrollDOM.scrollTop+=450); await page.waitForTimeout(80);
  const measured=await page.evaluate(()=>({scroll:window.view.scrollDOM.scrollTop,rows:document.querySelectorAll('[data-md-row]').length,raw:[...document.querySelectorAll('.cm-line')].some(e=>e.textContent.startsWith('| row'))}));
  assert.ok(!measured.raw,'React table fell back to source');
  assert.ok(measured.rows<150,'Table DOM grew beyond the visible row windows');
  assert.ok(measured.scroll>before+200,'React table scroll jumped backwards/stalled');
 }
 console.log('Real React tables: 55 scroll steps, bounded mounted rows, no source fallback.');
 const readme=await readFile(resolve(root,'README.md'),'utf8');
 const imageFixtures={};
 for(const match of readme.matchAll(/!\[[^\]]*\]\((specs\/assets\/[^)]+)\)/g)) {
  imageFixtures[match[1]]='data:image/png;base64,'+(await readFile(resolve(root,match[1]))).toString('base64');
 }
 await page.evaluate(fixtures=>window.imageFixtures=fixtures,imageFixtures);
 // Preserve the authored flow of standalone and nested HTML breaks.
 for(const html of ['<br>', '<br class="test">', '<span>inner<br title="x > y">next</span>']) {
  await page.evaluate(html=>window.mount('before '+html+' after text'),html);
  await page.waitForFunction(()=>[...document.querySelectorAll('.md-projection')].every(el=>el.childNodes.length>0&&!el.querySelector('.md-render-loading')));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>document.querySelector('.md-projection-InlineHTML br'));
  const lines=await page.evaluate(()=>{
   const walker=document.createTreeWalker(window.view.contentDOM,NodeFilter.SHOW_TEXT); const tops={};let node;
   while((node=walker.nextNode()))for(const word of ['before','after']) {
    const at=node.textContent.indexOf(word);if(at<0)continue;
    const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+word.length);tops[word]=range.getBoundingClientRect().top;
   }return tops;
  });
  assert.ok(lines.after>lines.before+10,'HTML break lost its text flow: '+html+' '+JSON.stringify(lines));
 }
 console.log('Standalone, attributed and nested HTML breaks preserve text flow.');
 const mixed='[![badge](badge.png)](https://example.com)\n[![badge](badge.png)](https://example.com)\n\ntext <br> after break\n\n'+Array.from({length:80},(_,i)=>'Paragraph '+i+' editable text.\n\n').join('');
 let clicks=0;
 for (const doc of [mixed,readme]) {
  await page.evaluate(doc=>window.mount(doc),doc); await page.waitForTimeout(500);
  let lastLine=0;
  for (let step=0;step<(doc===readme?70:8);step++) {
   await page.waitForFunction(()=>[...document.querySelectorAll('.md-projection')].every(el=>el.childNodes.length>0&&!el.querySelector('.md-render-loading')));
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const points=await page.evaluate(()=> {
    const v=window.view;
    const initial=v.scrollDOM.getBoundingClientRect();
    // Flush CM's pending geometry before retaining DOM nodes. posAtCoords can
    // synchronously replace viewport lines (notably in WebKit).
    v.posAtCoords({x:initial.left+24,y:initial.top+5});
    const b=v.scrollDOM.getBoundingClientRect();
    return [...v.contentDOM.querySelectorAll('.cm-line')].flatMap(line=>{
     const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);
     let text; while((text=walker.nextNode())) {
      if(text.parentElement.closest('.md-projection') || text.textContent.trim().length<8)continue;
      const r=document.createRange();r.setStart(text,2);r.setEnd(text,3); const rect=r.getBoundingClientRect();
      if(rect.top<b.top+10 || rect.bottom>b.bottom-10 || rect.width<1)continue;
      const pos=v.posAtDOM(text,2); const point={x:rect.left+1,y:(rect.top+rect.bottom)/2};
      const mapped=v.posAtCoords(point);
      return [{...point,line:v.state.doc.lineAt(pos).number,mapped:mapped===null?null:v.state.doc.lineAt(mapped).number}];
     } return [];
    });
   });
   for(const point of points) lastLine=Math.max(lastLine,point.line);
   for(const point of points) assert.equal(point.mapped,point.line,'Visual text maps to a different source line');
   if(points.length) {
    const point=points.at(-1); await page.mouse.click(point.x,point.y); await page.waitForTimeout(50);
    const selected=await page.evaluate(()=>window.view.state.doc.lineAt(window.view.state.selection.main.head).number);
    assert.equal(selected,point.line,'Click activates a different source line'); clicks++;
    if(step%10===0) {
     const before=await page.evaluate(()=>({doc:window.view.state.doc.toString(),pos:window.view.state.selection.main.head}));
     await page.keyboard.insertText('X');
     assert.equal(await page.evaluate(()=>window.view.state.doc.toString()),before.doc.slice(0,before.pos)+'X'+before.doc.slice(before.pos),'Typing changed the wrong source position');
     await page.keyboard.press('Meta+z');
     assert.equal(await page.evaluate(()=>window.view.state.doc.toString()),before.doc,'Undo did not restore exact source');
    }
   }
   if(await page.evaluate(()=>{const s=window.view.scrollDOM;return s.scrollTop+s.clientHeight>=s.scrollHeight-2}))break;
   await page.evaluate(()=>window.view.scrollDOM.scrollTop+=600); await page.waitForTimeout(100);
  }
  assert.ok(lastLine>=doc.split('\n').length-5,'Did not traverse the complete fixture');
 }
 await page.evaluate(()=>window.mount(' $x$'.repeat(8000)));
 for(const width of [390,250,650]) {
  await page.evaluate(width=>{document.querySelector('.md-editor-shell').style.width=width+'px';},width);
  await page.waitForTimeout(200);
  await page.evaluate(()=>{const s=window.view.scrollDOM;s.scrollTop=(s.scrollHeight-s.clientHeight)*.6});
  await page.waitForFunction(()=>{
   const v=window.view,b=v.scrollDOM.getBoundingClientRect();
   const pos=v.posAtCoords({x:b.left+40,y:b.top+b.height/2}),rect=pos===null?null:v.coordsAtPos(pos);
   const widgets=[...document.querySelectorAll('.md-projection-InlineMath')];
   return rect&&rect.bottom>rect.top&&widgets.length>0&&widgets.every(el=>el.querySelector('.katex'));
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const geometry=await page.evaluate(()=>{
   const v=window.view,b=v.scrollDOM.getBoundingClientRect(),y=b.top+b.height/2;
   const pos=v.posAtCoords({x:b.left+40,y});const rect=pos===null?null:v.coordsAtPos(pos);
   const widgets=[...document.querySelectorAll('.md-projection-InlineMath')];
   return {count:widgets.length,visible:widgets.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>b.top&&r.top<b.bottom}).length,viewport:v.viewport,scroll:v.scrollDOM.scrollTop,sourceTop:v.posAtCoords({x:b.left+24,y:b.top+2}),sourceBottom:v.posAtCoords({x:b.right-24,y:b.bottom-2}),y,top:rect?.top,bottom:rect?.bottom};
  });
  assert.ok(geometry.count>0&&geometry.count<2000,'Long physical line projection count at '+width+': '+JSON.stringify(geometry));
  assert.ok(geometry.top!==undefined&&geometry.y>=geometry.top-52&&geometry.y<=geometry.bottom+52,'Resize left a visible coordinate gap');
 }
 console.log('Dense inline math stays bounded across three resize/scroll states.');
 // Exercise the production outline without eagerly completing its parse.
 const outlineDoc='# Start\n\n'+Array.from({length:180},(_,i)=>'## Section '+i+'\n\n'+('Reading content '+i+'. ').repeat(35)+'\n\n').join('')+'## Same\n\nFirst duplicate\n\n## Same\n\nLast duplicate';
 await page.evaluate(doc=>window.mount(doc,false),outlineDoc);
 const trigger=page.getByRole('button',{name:'浏览文档目录'});
 await trigger.waitFor();
 await trigger.hover();
 await page.getByRole('navigation',{name:'目录'}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.md-outline-popover li').length===183);
 assert.ok(await page.locator('.md-outline-tick').count()<=24,'Long outline must keep its rail bounded');
 const beforeHover=await page.evaluate(()=>({doc:window.view.state.doc.toString(),height:window.view.contentHeight,scroll:window.view.scrollDOM.scrollTop}));
 await page.locator('.md-outline-popover').hover();await page.waitForTimeout(220);
 assert.equal(await trigger.getAttribute('aria-expanded'),'true','Hover bridge closed the outline');
 await page.mouse.move(850,690);await page.waitForTimeout(250);
 assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 assert.deepEqual(await page.evaluate(()=>({doc:window.view.state.doc.toString(),height:window.view.contentHeight,scroll:window.view.scrollDOM.scrollTop})),beforeHover,'Hover changed the document layout');
 await trigger.hover();await page.getByRole('button',{name:'Section 120',exact:true}).click();
 await page.waitForFunction(()=>window.view.state.doc.lineAt(window.view.state.selection.main.head).text==='## Section 120');
 await page.waitForTimeout(250);
 assert.ok(await page.evaluate(()=>{const v=window.view,r=v.coordsAtPos(v.state.selection.main.head),s=v.scrollDOM.getBoundingClientRect();return r&&r.top>=s.top&&r.top<s.top+65}),'Heading jump must align near the visible top');
 assert.equal(await page.evaluate(()=>window.view.state.doc.toString()),outlineDoc,'Outline navigation edited source');
 await trigger.press('ArrowDown');
 await page.waitForFunction(()=>document.activeElement?.textContent==='Section 120');
 await page.keyboard.press('End');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.view.state.selection.main.head===window.view.state.doc.toString().lastIndexOf('## Same'));
 await trigger.press('ArrowDown');await page.getByRole('navigation',{name:'目录'}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
 await trigger.hover();await page.getByRole('navigation',{name:'目录'}).waitFor();
 await page.evaluate(()=>window.setOptions({active:false}));assert.equal(await page.locator('.md-outline-popover').count(),0);
 await page.evaluate(()=>window.setOptions({sourceMode:true}));assert.equal(await page.locator('.md-outline-trigger').count(),0);
 await page.evaluate(()=>window.setOptions({}));await trigger.waitFor();
 await page.setViewportSize({width:320,height:700});
 await page.evaluate(()=>document.querySelector('.md-editor-shell').style.width='300px');
 await trigger.click();await page.getByRole('navigation',{name:'目录'}).waitFor();await page.waitForTimeout(150);
 assert.ok(await page.locator('.md-outline-popover').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight}),'Outline overflowed narrow viewport');
 await page.screenshot({path:'/tmp/myagents-markdown-outline-'+(process.argv[2]??'chromium')+'.png'});
 await page.setViewportSize({width:900,height:700});
 const prefixed='# Top\n\n'+('body\n\n'.repeat(25))+'  ## Indented\n\n'+('body\n\n'.repeat(25))+'> Quoted\n> ===\n\n'+('body\n\n'.repeat(30));
 await page.evaluate(doc=>window.mount(doc),prefixed);
 for(const title of ['Indented','Quoted']) {
  await trigger.click();await page.getByRole('button',{name:title,exact:true}).click();
  await page.waitForTimeout(200);
  await trigger.press('ArrowDown');
  await page.waitForFunction(title=>document.querySelector('.md-outline-popover [aria-current]')?.textContent===title,title);
  await page.keyboard.press('Escape');
 }
 console.log('Prefixed headings: quoted Setext labels and current-section highlighting passed.');
 console.log('Outline: full background index, hover stability, jump, duplicate headings, keyboard, hidden/source lifetime and narrow viewport passed.');
 assert.ok(clicks>=8); assert.deepEqual(errors,[]);
 console.log('Mixed HTML/images and full repository README: '+clicks+' click/source-line checks, typing and undo passed.');
} finally {await browser.close()}

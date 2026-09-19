// Explicit installed-SDK contract. Synthetic loopback servers only; no Google account.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { query } from '@anthropic-ai/claude-agent-sdk';
const require = createRequire(import.meta.url);
const native = join(dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), process.platform === 'win32' ? 'claude.exe' : 'claude');
const scratch=mkdtempSync(join(tmpdir(),'myagents-cliproxy-agent-contract-'));
const model='synthetic-main';
const childModel='synthetic-other-model';
const requests=[]; let terminal=false; let childSeen=false;
const controller=new AbortController();
const server=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req) text+=chunk;
  const body=JSON.parse(text||'{}');
  if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":10}');return;}
  if(!req.url.startsWith('/v1/messages')){res.writeHead(404);res.end();return;}
  const messages=JSON.stringify(body.messages);
  const done=body.messages?.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result'));
  const child=messages.includes('CHILD_CONTRACT_PROMPT')&&!done;
  requests.push({model:body.model,child,done}); if(child)childSeen=true;
  const block=(!child&&!done)?{type:'tool_use',id:'tool_contract_1',name:'Agent',input:{description:'Check selected model',prompt:'CHILD_CONTRACT_PROMPT reply CHILD_OK',subagent_type:'contract-agent',run_in_background:false}}:{type:'text',text:'CONTRACT_OK'};
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const send=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  send('message_start',{message:{id:'msg_contract_'+requests.length,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}});
  send('content_block_start',{index:0,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
  send('content_block_delta',{index:0,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
  send('content_block_stop',{index:0});
  send('message_delta',{delta:{stop_reason:block.type==='tool_use'?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});
  send('message_stop',{});res.end();
});
let proxyRequests = 0;
const proxy = http.createServer((_req,res)=>{ proxyRequests++; res.writeHead(403);res.end(); });
proxy.on('connect',(_req,socket)=>{ proxyRequests++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
await Promise.all([new Promise(r=>server.listen(0,'127.0.0.1',r)),new Promise(r=>proxy.listen(0,'127.0.0.1',r))]);
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
const timer=setTimeout(()=>controller.abort(),30000);
let q;
try{
  const env={PATH:process.env.PATH,HOME:scratch,USERPROFILE:scratch,TMPDIR:process.env.TMPDIR,
    CLAUDE_CONFIG_DIR:scratch,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'synthetic-local-key',
    ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR:'',
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_CLAUDEAI_MCP_SERVERS:'false',
    CLAUDE_CODE_USE_BEDROCK:'',CLAUDE_CODE_USE_VERTEX:'',CLAUDE_CODE_USE_FOUNDRY:'',
    HTTP_PROXY:proxyUrl,HTTPS_PROXY:proxyUrl,ALL_PROXY:proxyUrl,http_proxy:proxyUrl,https_proxy:proxyUrl,all_proxy:proxyUrl,NO_PROXY:'localhost,127.0.0.1,::1',no_proxy:'localhost,127.0.0.1,::1',
    ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_DEFAULT_FABLE_MODEL:model};
  q=query({prompt:'Run the contract-agent then report its answer.',options:{cwd:scratch,env,model,tools:['Agent'],mcpServers:{},settingSources:[],strictMcpConfig:true,
    permissionMode:'bypassPermissions',allowDangerouslySkipPermissions:true,maxTurns:3,abortController:controller,persistSession:false,
    pathToClaudeCodeExecutable:native,
    agents:{'contract-agent':{description:'Check model binding',prompt:'Obey the synthetic contract.',tools:[],model:childModel}}}});
  for await(const message of q){if(message.type==='result'){terminal=message.subtype==='success';break;}}
  assert.equal(terminal,true);assert.equal(childSeen,true);assert.ok(requests.length>=3);assert.ok(requests.filter(r=>r.child).every(r=>r.model===childModel));assert.ok(requests.filter(r=>!r.child).every(r=>r.model===model));
  assert.equal(proxyRequests,0);
  console.log(JSON.stringify({success:true,proxyRequests,requests}));
}finally{clearTimeout(timer);controller.abort();q?.close();server.closeAllConnections();proxy.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>proxy.close(r))]);rmSync(scratch,{recursive:true,force:true});}

#!/usr/bin/env node
// Credentialed harness launched by the ignored Rust native-account test.
// Only the local model key crosses stdin; Google credentials stay in the
// native-owned auth-dir. Output contains contract results, never content.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { CLIPROXY_VERIFICATION_PROMPT, cliproxySdkSystemPrompt } from '../src/shared/cliproxy.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
let input = '';
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (input.length > 16_384) throw new Error('Oversized harness input');
}
const { baseUrl, apiKey, model, thinking = false } = JSON.parse(input);
if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(baseUrl) || typeof apiKey !== 'string'
  || apiKey.length < 32 || typeof model !== 'string' || !model) throw new Error('Invalid harness binding');
const require = createRequire(import.meta.url);
const sdkRoot = dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`));
const native = join(sdkRoot, process.platform === 'win32' ? 'claude.exe' : 'claude');
const scratch = mkdtempSync(join(tmpdir(), 'myagents-cliproxy-sdk-'));
const nonce = randomUUID();
let toolCalls = 0;
let sawThinking = false;
let stage = 'tool-roundtrip';
const runs = [];
const server = createSdkMcpServer({ name: 'subscription-verification', tools: [tool('check_connection',
  'Return the current connection verification code. No side effects.', {}, async () => {
    toolCalls++;
    return { content: [{ type: 'text', text: nonce }] };
  })] });
const env = Object.fromEntries(['HOME', 'USERPROFILE', 'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { CLAUDE_CONFIG_DIR: scratch, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: apiKey,
  ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '', CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  CLAUDE_CODE_USE_BEDROCK: '', CLAUDE_CODE_USE_VERTEX: '', CLAUDE_CODE_USE_FOUNDRY: '',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1',
  ANTHROPIC_DEFAULT_FABLE_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model });
async function run(prompt, options) {
  const controller = new AbortController();
  let terminal = false; let text = ''; let sessionId; let terminalSubtype; let assistantError;
  const contentTypes = new Set();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const instance = query({ prompt, options: { cwd: scratch, env, pathToClaudeCodeExecutable: native, model,
    tools: [], mcpServers: { 'subscription-verification': server }, settingSources: [], strictMcpConfig: true,
    permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
    maxTurns: 3, abortController: controller, thinking: { type: thinking ? 'adaptive' : 'disabled' },
    systemPrompt: cliproxySdkSystemPrompt(CLIPROXY_VERIFICATION_PROMPT),
    ...options } });
  try {
    for await (const message of instance) {
      if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id;
      if (message.type === 'assistant') {
        if (message.error) {
          assistantError = /^[a-z_]{1,64}$/.test(message.error) ? message.error : 'other';
          throw new Error('Model request failed');
        }
        for (const block of message.message.content) {
          contentTypes.add(block.type);
          if (block.type === 'text') text += block.text;
          if (block.type === 'thinking' && block.thinking) sawThinking = true;
        }
      }
      if (message.type === 'result') { terminalSubtype = message.subtype; terminal = message.subtype === 'success'; break; }
    }
    return { terminal, text, sessionId };
  } finally {
    runs.push({ terminal, terminalSubtype, assistantError, hasSession: !!sessionId, hasNonce: text.includes(nonce), contentTypes: [...contentTypes] });
    clearTimeout(timeout); controller.abort(); instance.close();
  }
}
try {
  const first = await run('Call check_connection exactly once. Then reply with the exact code returned by the tool.', { sessionId: randomUUID() });
  if (!first.terminal || toolCalls !== 1 || !first.text.includes(nonce) || !first.sessionId) throw new Error('SDK tool round-trip did not complete');
  stage = 'history';
  const resumed = await run('Without calling any tool, repeat the verification code from the previous turn.', { resume: first.sessionId });
  if (!resumed.terminal || toolCalls !== 1 || !resumed.text.includes(nonce)) throw new Error('SDK history resume did not complete');
  stage = 'thinking';
  if (thinking && !sawThinking) throw new Error('Requested thinking capability was not observed');
  console.log(JSON.stringify({ success: true, sdkVersion: pkg.dependencies['@anthropic-ai/claude-agent-sdk'],
    model, tools: true, history: true, thinking: sawThinking, inputModalities: ['text'], outputModalities: ['text'] }));
} catch {
  console.log(JSON.stringify({ success: false, model, stage, toolCalls, sawThinking, runs, error: 'Credentialed SDK contract did not complete' }));
  process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }

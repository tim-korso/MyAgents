# 原型 B 范例：API 包装工具（video-brief）

调外部 API、带密钥、多步工作流（提交 → 轮询 → 取结果）。云厂商能力（语音合成、视频理解、OCR）、多模态大模型调用都长这样。**照着这个结构改**——把 `TODO` 标记处换成真实厂商的 endpoint 与字段。

与原型 A 的全部差异点：`envKeys` 声明密钥、缺 key 时退出码 `3`、所有 fetch 带超时、轮询有上限、上游错误翻译成可行动的 remediation。

## tool.json

```json
{
  "name": "video-brief",
  "version": "1.0.0",
  "description": "用多模态大模型 API 理解视频内容并产出摘要。用户给一个视频文件要\"总结/理解/提取要点/这视频讲了什么\"时使用；也适用于批量为视频生成文字简介。仅支持本地视频文件路径输入；纯图片理解不要用这个（图片场景另有方案）。快速参考：video-brief input.mp4 --question \"总结要点\" --json。需要先配置 VIDEO_API_KEY（myagents tool env video-brief set VIDEO_API_KEY=...）。处理时长与视频长度相关，分钟级视频约需 1-3 分钟。首次使用前先运行 `video-brief readme`；机器可读输出加 --json。",
  "entry": "run.mjs",
  "runtime": "node",
  "envKeys": ["VIDEO_API_KEY"],
  "deps": []
}
```

> 注意 description 里做了三件原型 A 没有的事：声明前置条件（先配 key 的完整命令）、声明耗时量级（生死线 5 的 readme 要求提前到 description，因为这直接影响 Agent 的调用决策）、反模式指向替代方案。

## run.mjs

```js
#!/usr/bin/env node
// video-brief — 多模态大模型视频理解
// 退出码：0 成功 / 1 一般错误 / 2 用法错误 / 3 环境缺失（key）
import { parseArgs } from 'node:util';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// TODO: 换成真实厂商的 endpoint 与认证头形态
const API_BASE = 'https://api.example-vendor.com/v1';
const SUBMIT_TIMEOUT_MS = 60_000;   // 上传/提交
const POLL_TIMEOUT_MS   = 15_000;   // 单次轮询
const POLL_INTERVAL_MS  = 5_000;
const POLL_MAX_TRIES    = 60;       // 上限 5 分钟（生死线：轮询必须有界）
const MAX_FILE_MB       = 200;

const HELP = `video-brief — 用多模态大模型理解视频并产出摘要

用法:
  video-brief <video-file> [--question <q>] [--json]
  video-brief readme
  video-brief --help

参数:
  <video-file>   本地视频文件（mp4/mov/webm，≤${MAX_FILE_MB}MB）
  --question     聚焦问题（默认"总结这个视频的核心内容"）
  --json         以 JSON 输出 {summary, durationSec, model}

环境变量:
  VIDEO_API_KEY  必需。设置: myagents tool env video-brief set VIDEO_API_KEY=<key>

示例:
  video-brief demo.mp4
  video-brief lecture.mp4 --question "列出讲到的所有工具名" --json
  video-brief ~/Movies/meeting.mov --question "谁提出了什么决策"

退出码: 0 成功 | 1 一般/上游错误 | 2 用法错误 | 3 缺 VIDEO_API_KEY
耗时: 与视频长度相关，分钟级视频约 1-3 分钟`;

const README = `# video-brief

## 何时使用
对本地视频做内容理解：总结、要点提取、按问题聚焦分析。
不适用：纯图片理解、需要逐帧时间戳的精细分析、在线视频 URL（先下载）。

## 快速开始
myagents tool env video-brief set VIDEO_API_KEY=<key>   # 仅首次
video-brief demo.mp4 --question "总结要点"

## 参数
<video-file>  本地路径，mp4/mov/webm，≤${MAX_FILE_MB}MB
--question    聚焦问题；不给则做通用摘要
--json        机器可读输出

## 示例
video-brief lecture.mp4 --question "列出所有提到的论文" --json
video-brief meeting.mov --question "整理决策与待办"
video-brief demo.mp4

## 失败模式
退出码 3 = 未配置 VIDEO_API_KEY（remediation 给出完整设置命令）。
退出码 2 = 文件不存在/格式不支持/超大小限制。
退出码 1 = 上游 API 错误（401 = key 无效需重设；429 = 限流稍后重试；
轮询超时 = 视频过长，建议剪短或分段）。
所有错误都在 stderr 以 JSON 给出 code 与 remediation。

## 产物回流
结果是文本摘要（stdout）。调用方（Agent）把摘要整理进回复正文；
若用户要求落盘，写入工作区文件并在回复中以 Markdown 链接引用。`;

function fail(code, errCode, message, remediation) {
  process.stderr.write(JSON.stringify({ error: message, code: errCode, remediation }) + '\n');
  process.exit(code);
}

const rawArgs = process.argv.slice(2);
if (rawArgs[0] === 'readme') { console.log(README); process.exit(0); }

let args;
try {
  args = parseArgs({
    args: rawArgs,
    options: {
      question: { type: 'string', default: '总结这个视频的核心内容' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
} catch (e) {
  fail(2, 'BAD_ARGS', e.message, '运行 video-brief --help 查看用法');
}
if (args.values.help) { console.log(HELP); process.exit(0); }

// ① 环境自检（缺 key = 退出码 3 + 可行动 remediation，绝不裸崩）
const apiKey = process.env.VIDEO_API_KEY;
if (!apiKey) fail(3, 'MISSING_ENV', '未配置 VIDEO_API_KEY',
  '运行: myagents tool env video-brief set VIDEO_API_KEY=<key>（key 由用户提供）');

// ② 本地先验证（发任何网络请求之前）
const file = args.positionals[0];
if (!file) fail(2, 'NO_INPUT', '未提供视频文件', '用法: video-brief <video-file>，见 --help');
const path = resolve(file);
if (!existsSync(path)) fail(2, 'FILE_NOT_FOUND', `文件不存在: ${path}`, '检查路径；用绝对路径最稳');
if (!/\.(mp4|mov|webm)$/i.test(path)) fail(2, 'BAD_FORMAT', '仅支持 mp4/mov/webm', '先转码再调用');
const sizeMB = statSync(path).size / 1024 / 1024;
if (sizeMB > MAX_FILE_MB) fail(2, 'TOO_LARGE', `文件 ${sizeMB.toFixed(0)}MB 超过 ${MAX_FILE_MB}MB 上限`, '剪辑或压缩后重试');

const auth = { Authorization: `Bearer ${apiKey}` };

// 统一的上游错误翻译：HTTP 状态 → 可行动建议
function upstreamFail(res, body) {
  const map = {
    401: ['INVALID_KEY', 'key 无效或过期。重新设置: myagents tool env video-brief set VIDEO_API_KEY=<新key>'],
    429: ['RATE_LIMITED', '上游限流。等待 1 分钟后重试'],
  };
  const [code, remediation] = map[res.status] ?? ['UPSTREAM_ERROR', `上游返回 ${res.status}，原文: ${body.slice(0, 200)}`];
  fail(1, code, `API 错误 (HTTP ${res.status})`, remediation);
}

try {
  // ③ 提交（fetch 必带超时——生死线 5）
  process.stderr.write(`uploading ${basename(path)} (${sizeMB.toFixed(1)}MB)...\n`);
  // TODO: 按真实厂商协议构造（multipart 上传 / 先传 OSS 再给 URL 等）
  const submitRes = await fetch(`${API_BASE}/video/tasks`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/octet-stream', 'X-Question': encodeURIComponent(args.values.question) },
    body: readFileSync(path),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  if (!submitRes.ok) upstreamFail(submitRes, await submitRes.text());
  const { task_id } = await submitRes.json();

  // ④ 轮询（有次数上限——绝不无界等待）
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${API_BASE}/video/tasks/${task_id}`, {
      headers: auth, signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (!pollRes.ok) upstreamFail(pollRes, await pollRes.text());
    const data = await pollRes.json();
    process.stderr.write(`poll ${i + 1}/${POLL_MAX_TRIES}: ${data.status}\n`);     // 进度走 stderr

    if (data.status === 'succeeded') {
      if (args.values.json) {
        console.log(JSON.stringify({ summary: data.summary, durationSec: data.duration_sec, model: data.model }));
      } else {
        console.log(data.summary);
      }
      process.exit(0);
    }
    if (data.status === 'failed') fail(1, 'TASK_FAILED', `上游处理失败: ${data.error ?? 'unknown'}`, '换更短的视频重试；持续失败则是上游问题');
  }
  fail(1, 'POLL_TIMEOUT', `轮询 ${POLL_MAX_TRIES} 次后任务仍未完成`, '视频可能过长，剪短或分段后重试');
} catch (e) {
  if (e.name === 'TimeoutError') fail(1, 'NETWORK_TIMEOUT', '请求超时', '检查网络后重试；持续超时考虑文件过大');
  fail(1, 'UNEXPECTED', e.message, '带 --json 重跑并把 stderr 反馈给用户');
}
```

## 这个范例展示的（原型 A 之外的）要点

| 要点 | 体现在 |
|------|--------|
| 缺 key = 退出码 3 + 完整修复命令 | `MISSING_ENV` 分支，remediation 直接给 `myagents tool env ...` 原文 |
| 本地先验证 | 存在性/格式/大小检查全部发生在第一个 fetch 之前 |
| 一切 fetch 有界 | `AbortSignal.timeout` 三处；轮询 60 次封顶 |
| 上游错误翻译 | `upstreamFail`：401/429 映射到**可行动**建议，不是裸状态码 |
| 进度走 stderr | 上传提示与 poll 进度都不污染 stdout 结果 |
| 耗时声明 | description 与 --help 都写了"分钟级视频约 1-3 分钟" |

## 自测时的额外一项

故意不设 key 跑一遍，确认得到的是退出码 `3` + JSON remediation，而不是异常栈：

```bash
env -u VIDEO_API_KEY node run.mjs test.mp4; echo "exit=$?"
```

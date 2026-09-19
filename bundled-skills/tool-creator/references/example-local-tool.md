# 原型 A 范例：纯本地处理工具（md-merge）

文件进文件出、零网络、零密钥。这是最常见的原型：文档加工、格式转换、批量重命名、数据抽取都长这样。**照着这个结构改，不要从零发明。**

## tool.json

```json
{
  "name": "md-merge",
  "version": "1.0.0",
  "description": "合并多个 Markdown 文件为一个文档。用户要把多篇 markdown 笔记/章节/报告拼成一个文件、或要求\"把这些 md 合成一份\"时使用；也适用于把目录下所有 .md 汇总成单文档再做后续转换。单文件场景不要用（直接处理即可）。快速参考：md-merge a.md b.md --out merged.md；md-merge docs/*.md --out book.md --separator hr。首次使用前先运行 `md-merge readme`；机器可读输出加 --json。",
  "entry": "run.mjs",
  "runtime": "node",
  "envKeys": [],
  "deps": []
}
```

> description 解剖：能力声明（第 1 句）→ 触发条件（"用户要…时"）→ 反模式（"单文件场景不要用"）→ quick reference（2 行）→ 固定收尾。共 ~230 字符，余量充足。

## run.mjs

```js
#!/usr/bin/env node
// md-merge — 合并多个 Markdown 文件
// 退出码：0 成功 / 1 一般错误 / 2 用法错误
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HELP = `md-merge — 合并多个 Markdown 文件为一个文档

用法:
  md-merge <files...> --out <path> [--separator <hr|blank>] [--json]
  md-merge readme        # 完整使用文档
  md-merge --help

参数:
  <files...>     要合并的 .md 文件（按给定顺序拼接）
  --out          输出文件路径（必填）
  --separator    文件之间的分隔: hr(默认,---) | blank(空行)
  --json         以 JSON 输出结果

示例:
  md-merge ch1.md ch2.md ch3.md --out book.md
  md-merge notes/a.md notes/b.md --out summary.md --separator blank
  md-merge $(ls docs/*.md | sort) --out docs-all.md --json

退出码: 0 成功 | 1 一般错误 | 2 用法/参数错误`;

const README = `# md-merge

## 何时使用
把多个 Markdown 文件按顺序拼接为一个文档：多章节笔记汇总、报告合并、
为"转 docx/pdf"做前置准备。不适用：单文件转换（直接处理）、需要按标题
重排内容的场景（先手工整理顺序再合并）。

## 快速开始
md-merge ch1.md ch2.md --out book.md

## 参数
<files...>   输入文件，按给定顺序拼接；任何一个不存在即报错退出
--out        输出路径（必填）；已存在时会被覆盖
--separator  hr = 文件间插入 "---"（默认）；blank = 仅空行
--json       结果以 JSON 输出 {out, files, bytes}

## 示例
md-merge intro.md body.md outro.md --out report.md
md-merge $(ls chapters/*.md | sort) --out book.md
md-merge a.md b.md --out merged.md --separator blank --json

## 失败模式
退出码 2：缺 --out、没给输入文件、或某个输入文件不存在（stderr JSON 的
remediation 会指出是哪个）。退出码 1：写出失败（目标目录不存在等）。

## 产物回流
产物（合并后文件）的绝对路径打印在 stdout。调用方（Agent）必须在回复中
以 Markdown 链接引用该文件让用户看到；IM 会话中用
\`myagents im send-media --file <path>\` 发送。`;

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
      out: { type: 'string' },
      separator: { type: 'string', default: 'hr' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
} catch (e) {
  fail(2, 'BAD_ARGS', e.message, '运行 md-merge --help 查看用法');
}

if (args.values.help) { console.log(HELP); process.exit(0); }

// 本地先验证（生死线：进入实际工作前把参数错误全拦下）
const files = args.positionals;
if (files.length === 0) fail(2, 'NO_INPUT', '未提供输入文件', '至少给一个 .md 文件，见 md-merge --help');
if (!args.values.out) fail(2, 'NO_OUT', '缺少 --out 参数', '加 --out <输出路径>');
if (!['hr', 'blank'].includes(args.values.separator))
  fail(2, 'BAD_SEPARATOR', `separator 只能是 hr 或 blank，收到 "${args.values.separator}"`, '改用 --separator hr 或 --separator blank');
for (const f of files) {
  if (!existsSync(f)) fail(2, 'FILE_NOT_FOUND', `输入文件不存在: ${f}`, '检查路径拼写；用绝对路径最稳');
}

try {
  const sep = args.values.separator === 'hr' ? '\n\n---\n\n' : '\n\n';
  const merged = files.map((f) => readFileSync(f, 'utf8').trimEnd()).join(sep) + '\n';
  const outPath = resolve(args.values.out);
  writeFileSync(outPath, merged, 'utf8');

  // 产物绝对路径进 stdout（生死线 6）
  if (args.values.json) {
    console.log(JSON.stringify({ out: outPath, files: files.length, bytes: merged.length }));
  } else {
    console.log(outPath);
    process.stderr.write(`merged ${files.length} files, ${merged.length} bytes\n`); // 诊断走 stderr
  }
} catch (e) {
  fail(1, 'WRITE_FAILED', `写出失败: ${e.message}`, '确认 --out 的父目录存在且可写');
}
```

## 这个范例展示的生死线

| 生死线 | 体现在 |
|--------|--------|
| 1 非交互 | 全程无 stdin；覆盖已存在文件的行为在 readme 写明而非弹确认 |
| 2 三通道 | 结果（路径）走 stdout，"merged N files" 诊断走 stderr，退出码 0/1/2 |
| 3 --json + 结构化错误 | `fail()` 统一输出 `{error, code, remediation}` |
| 5 有界 | 纯同步本地 IO，天然有界 |
| 6 产物回流 | stdout 打印绝对路径；readme 有「产物回流」章节 |
| 8 零依赖 | 只用 node: 内置模块；`deps: []` |

> 覆盖确认的取舍说明：本工具覆盖输出文件**不做**确认协议（退出码 4 那套），因为 --out 是调用方显式给出的路径、意图明确。如果你的工具会动**没被显式指定**的文件（批量重命名、清理），就必须上确认协议——缺 `--yes` 时打印变更清单 + 完整重跑命令，exit 4。

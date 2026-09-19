---
name: tool-creator
description: 把用户的可复用需求封装成标准化的 Agent-CLI 工具，并用 `myagents tool add` 注册进 MyAgents 工具注册表——注册后所有未来会话（builtin / Claude Code / Codex / Gemini 全 runtime）的 AI 都会在 system prompt 里自动发现它。触发场景：(1) 用户说「把 XX 封装成工具」「做成一个工具」「注册个工具」「写个 CLI」「以后能直接用」；(2) 用户描述一个会反复出现的自动化需求——文档/文件批量处理、调用某个云 API、用某个多模态大模型做图像/视频理解等，即使没说"工具"两个字；(3) 你发现自己第二次为同类需求写几乎一样的脚本——这时要主动提议把它升格为注册工具，不要等用户开口。反向边界：一次性任务就地解决、不铸工具；接入现成的 MCP server 用 `myagents mcp`，不归这里。
---

# Tool Creator — 创建并注册 Agent-CLI 工具

你正在 MyAgents 里运行。MyAgents 有一个**工具注册表**（`~/.myagents/tools/`）：注册进去的 CLI 工具会被投放到 PATH（`~/.myagents/bin/`），它的 description 会自动注入所有未来会话的 system prompt——**未来的 AI（包括别的 runtime 上的）会自己想起它、查它的用法、调用它**。用户也能在设置页「工具箱」里看到并管理它。

这个 skill 教你两件事：**写出一个对 Agent 友好的合格 CLI 工具**，以及**把它注册进去**。

## 第 0 步：判断要不要铸工具

铸一个工具是在为未来的几百次调用做投资，但注册表里的每个工具都占一行 system prompt。判断标准：

- **铸**：需求会重复出现（用户明说"以后还要用"，或你已经第二次写同类脚本）；有清晰的输入→输出边界；参数可枚举。
- **不铸**：一次性任务（就地写脚本跑完即弃）；纯交互探索类需求；已有注册工具能覆盖（先 `myagents tool list` 查一遍）。
- 模型管理器里已配置的模型、单发单收的调用——未来由 `myagents model call` 覆盖（若该命令存在，优先用它，不铸工具）。

灰色地带主动问用户："这个要不要我注册成工具，以后直接用？"

## 第 1 步：选原型

| 原型 | 特征 | 范例（动手前先读对应那个） |
|------|------|--------------------------|
| **A · 纯本地处理** | 文件进文件出，零网络、零密钥 | `references/example-local-tool.md` |
| **B · API 包装** | 调外部 API，有密钥，可能多步工作流（上传→轮询→取结果） | `references/example-api-tool.md` |

两个范例都是完整可跑的代码，**照着改，不要从零发明结构**。

## 第 2 步：写工具——形态契约

### 目录布局

```
~/.myagents/tools/<tool-name>/
├── tool.json      # manifest（注册时被读取校验）
└── run.mjs        # 入口，Node 单文件
```

### tool.json

```json
{
  "name": "md-merge",
  "version": "1.0.0",
  "description": "<≤800 字符，见第 3 步的撰写模板>",
  "entry": "run.mjs",
  "runtime": "node",
  "envKeys": [],
  "deps": []
}
```

- `name`：kebab-case，3–30 字符。**起名避开常见系统命令**（`curl`、`jq`、`git`、`node`…）——`~/.myagents/bin` 在 PATH 里排在系统路径之前，重名会遮蔽系统命令，注册时会被直接打回。加领域前缀最稳妥（`md-merge` 而不是 `merge`）。
- `envKeys`：工具需要的环境变量名列表（API key 等）。
- `deps`：依赖的外部二进制（`ffmpeg` 等），没有就空数组。

### 技术栈

内置 Node v24 单文件 + `node:util` 的 `parseArgs`，**零第三方依赖**。这不是偏好是约束：MyAgents 已内置 Node 并打通全部 PATH，单文件意味着没有 node_modules、拷目录即分发、跨平台问题已被产品解决过一遍。确实绕不开外部二进制时声明进 `deps` 并做启动自检（见生死线 8）。

### 八条生死线

每条都解释了违反的后果——它们不是风格偏好，是工具在 Agent 手里能不能活的分界：

1. **绝对禁止交互式输入。** 任何 stdin prompt（确认、选择、密码）都会让 Agent 的 shell 调用永久挂死——Agent 没有键盘。危险操作（删除、覆盖、花钱）用确认协议替代：缺 `--yes` 时打印将要做的变更 + 完整的带 `--yes` 重跑命令，以退出码 `4` 退出。Agent 会把变更展示给用户、获准后重跑。
2. **stdout 只放结果，stderr 放诊断，退出码语义化。** Agent 判断成败只靠这三样。退出码约定：`0` 成功 / `1` 一般错误 / `2` 用法或参数错误 / `3` 环境缺失（缺 env key、缺依赖）/ `4` 需要确认。进度提示、调试信息一律 stderr；spinner / 彩色转义码对 Agent 是纯噪音，不要。
3. **必须有 `--json` 模式，错误也要结构化。** 默认输出给人读的简洁文本；`--json` 输出机器可解析结果。出错时 stderr 给一行 JSON：`{"error": "...", "code": "...", "remediation": "怎么修"}`——`remediation` 是给下一个 Agent 的可行动建议（"run `myagents tool env <name> set KEY=...`"），不是模糊的 "something went wrong"。
4. **密钥走 env，绝不走 argv。** argv 会泄进进程列表和日志。从 `process.env[KEY]` 读，缺失时按退出码 `3` + remediation 处理。key 在 `tool.json::envKeys` 声明，由 `myagents tool env <name> set KEY=value` 设置。
5. **有界运行时间。** 不准变 daemon。所有网络请求带 `AbortSignal.timeout(...)`；轮询循环必须有次数/时间上限。预期超过 30 秒的操作在 readme 里声明耗时量级。
6. **产物文件输出绝对路径到 stdout。** 生成的文件落到当前工作区（或用户指定路径），把绝对路径作为结果打印——这是下游（预览、IM 发送）能接住产物的前提。
7. **readme 子命令返回标准化使用文档。** 固定章节（见第 3 步），未来的 AI 第一次用这个工具前会先跑 `<tool> readme`。
8. **依赖自检，失败要可行动。** `deps` 里声明的二进制在启动时探测（等效 `which`），缺失则按生死线 3 的错误格式给出安装指引 + 退出码 `3`——Agent 拿到的是"装 ffmpeg：brew install ffmpeg"，不是一个看不懂的崩溃栈。

### 三条进阶约定（让工具经得起时间）

- **接口即契约**：工具被注册后，未来的 Agent 会从历史会话、readme 缓存里学到它的参数。改版时只加不改不删——加新参数可以，改既有参数的含义/删参数等于在所有学过它的 Agent 脚下抽地毯。
- **高信号输出**：返回语义化字段（文件名、人类可读状态），不要裸 UUID / 内部 ID / 全量原始响应。输出大时做截断并提示如何取全量（`--limit`/`--offset`）。
- **本地先验证**：参数格式、文件存在性在发网络请求**之前**验证，错误更快更准（退出码 `2`）。

## 第 3 步：写三面文档

工具有三个文档面，**各答各的问题，不许混**：

| 面 | 回答 | 消费者 |
|----|------|--------|
| `description`（tool.json） | "什么情况下该想起我" | system prompt 注入 + 设置页列表 |
| `--help` | "参数怎么传" | AI 调用前现查 + 终端用户 |
| `readme` 子命令 | "解决这类问题的方法论" | AI 决定用之后 fetch + 设置页详情 |

### description（≤800 字符，超长注册时被打回）

这 800 字符决定未来的 AI 会不会想起这个工具。按五件套写：

1. 一句话能力声明
2. **触发条件**——给具体的用户说法（"用户要合并多个 markdown / 把文档拼成一个文件时"）。这是五件套里最值钱的部分：写"什么时候用"，不要重复"是什么"
3. 反模式排除（如有）："单文件转换不要用这个，直接处理即可"
4. 2–4 行 quick reference（最常用的调用形态）
5. 收尾固定句式：`首次使用前先运行 \`<tool> readme\`；机器可读输出加 --json`

写完做"新同事测试"：一个不知道这个工具存在的同事（或 AI），只读这 800 字符，能不能在对的时机想起它、并大致知道怎么开始？参数命名同理——`--input-file` 不要 `--i`，歧义是 Agent 的第一杀手。写不下的细节全部挪进 readme。

### --help

必含：用法契约行（`md-merge <files...> --out <path> [--json]`）、每个参数一行说明、**至少 3 条贴近真实的示例**（Agent 靠示例适配自己的场景）、退出码表。

### readme 子命令

固定章节，顺序不变（AI 每次读到的形状一致才能快速定位）：

```markdown
# <tool-name>
## 何时使用       # 适用场景 + 不适用场景
## 快速开始       # 最小可用示例
## 参数           # 完整参数表（与 --help 一致）
## 示例           # 3+ 个真实场景的完整命令
## 失败模式       # 每种退出码/常见错误的含义与处理
## 产物回流       # 产物落在哪、怎么展示给用户（见下）
```

**产物回流章节是强制的**：写明"调用方（Agent）拿到产物路径后，必须在回复中引用它（Markdown 链接/图片）；IM 会话里用 `myagents im send-media --file <path>` 发送"。工具跑成功但用户看不到结果 = 这次调用白跑。

## 第 4 步：自测三连

注册前在 shell 里依次验证，任何一项不过就修：

```bash
node run.mjs --help        # 用法契约行 + 示例齐全？
node run.mjs readme        # 六个固定章节齐全？
node run.mjs <真实参数>     # 一次真实调用：stdout 干净？exit code 对？--json 可解析？
```

原型 B 还要验：故意不设 env key 跑一次——应得到退出码 `3` + 带 remediation 的 JSON 错误，而不是裸异常栈。

## 第 5 步：注册 + 告知

```bash
myagents tool add ~/.myagents/tools/<tool-name>     # 校验 manifest、投 shim、进注册表
myagents tool env <tool-name> set API_KEY=<value>    # 原型 B：设密钥（让用户提供，绝不编造）
myagents tool list                                   # 确认出现在清单里
```

`tool add` 的常见打回：description 超 800 字符（精简后重试）、工具名撞系统命令（换名加前缀）。报错里带 recoveryHint，照做即可。

**注册成功后必须在回复中明确告知用户**（可审计性，不可省略）：

> 已注册工具 `md-merge`（合并多个 Markdown 文件）。我和之后的会话都能直接用它；你可以在 设置 → 工具箱 里查看、停用或删除它。

注册的工具对**当前 session 之外**的会话在它们下次启动时生效；你自己刚写完它，本 session 直接用就行。

如果 `myagents tool --help` 报 unknown command：当前 app 版本还没有注册机。把工具完整写好放在 `~/.myagents/tools/<name>/`，告知用户"工具已就绪，等应用更新后运行 `myagents tool add` 注册"。

## 速查：完整流程

```
判断值不值得铸（第 0 步）
→ 选原型 A/B，读对应 references 范例（第 1 步）
→ 写 tool.json + run.mjs，过八条生死线（第 2 步）
→ 写 description 五件套 / --help / readme（第 3 步）
→ 自测三连（第 4 步）
→ tool add + env + 告知用户（第 5 步）
```

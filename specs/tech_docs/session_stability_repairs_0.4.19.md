# 0.4.19 会话稳定性修复记录

本文记录同一轮问题排查的两次修复及验收证据。长期 owner 规范见 [Session 架构](session_architecture.md)、[Task Center](task_center.md)、[IM 架构](im_integration_architecture.md) 和 [Pit of Success](pit_of_success.md)。

## 前轮：保存、身份、回溯与分叉

对应提交：`fd5c6992`、`1cd5094f`，文档对齐 `101b20e4`。

| 问题/触发条件 | 根因与最终处理 |
|---|---|
| 回溯后保存提示异常 | 显式历史修改必须由 SessionStore/writer 提交新边界，不能让旧快照继续追加。保留真实 IO 错误，消除状态错位导致的假故障。 |
| 空 Agent id / 重复 id 使工作区列表不可用 | 历史配置兼容读取按条处理；缺失身份与真实冲突分别裁决，不因单条坏记录阻断全部正常工作区。 |
| 正常历史被笼统判为不可回溯 | 使用真实 native chain UUID 与精确产品历史前缀。缺少必要锚点仍返回明确错误，不清空锚点后继续完整旧历史。 |
| Fork 在慢磁盘/历史刷新时失败 | 显式操作等待实际 flush/publication；移除固定短时限导致的取消。新分支先实体化 native history，再发布产品 Session。 |
| Fork 后继续缺失/多出上下文 | 完整执行快照共用 snapshot helper；旧 lazy 分支仅在兼容读取时解析 native 来源；新建不再产生 lazy 分支。 |
| Retry 由 UI 拼接 rewind + resend | 同一 SessionEngine mutation scope 完成回溯与普通 send admission，保留并发入队消息；重发接纳和 turn 成功分开。 |
| 丢响应或打开失败导致错误回滚 | 回读已提交事实；Fork 稳定目标 identity 支持查询同一结果；已发布分支不因打开 Tab 失败而删除。文件恢复、历史提交、Runtime restore 分别报告真实结果。 |

这些处理没有取消必要的身份、边界、持久化和路径校验；删除的是以猜测结果代替真实状态的超时与补偿逻辑。

## 本轮：前端业务编排归位

| 用户意图 | 权威入口 | 失败语义 |
|---|---|---|
| 修改一个配置字段 | 既有 Agent config writer 锁内解析字段意图 | 只修改指定字段。模型选择和已有执行 context 分离，避免旧页面权限/effort 修改覆盖新模型。 |
| 切换 Runtime / 打开新会话 | 配置 writer、Session owner、App Tab owner 各自负责自己的提交 | 导航/渠道交接失败不恢复旧配置，也不删除已发布 Session。 |
| 创建并启动定时 Task | TaskApplication → TaskStore / scheduler | 返回保留的 Task 与启动错误，取消前端 delete 补偿；明确取消可以 stop，Tab 卸载不撤销已接纳任务。 |
| 启用/停用 Channel | Rust 既有 Channel lifecycle lock 内保存 enabled 并处理连接 | 失败可见，配置刷新；不会出现旧停用请求的后半段关闭新启用连接。异常但已启用时仍能停止，取消自动重连。 |
| 停止响应 | SessionEngine 的状态/terminal 与执行事件 | 回执/5 秒超时不造出 stopped；回读状态受前端执行观察、restore、connection fence 约束。 |
| 新对话/reset | 后端提交新 binding、执行配置快照并等待元数据落盘后 UI 采用结果 | 新空会话可立即绑定 Task/Goal，重启后模型不丢；拒绝保留历史；丢响应查询 binding；打开失败不降级为清空当前会话。 |

仍复用现有锁、Store、facade、SSE 和配置写入协议；没有新增事务框架、后台补偿队列、操作持久日志或跨进程 exactly-once 承诺。配置 writer 仍遵循三端共享文件锁，未进行全量存储迁移。

## 审查及实测追加修复

Requirements / adversarial 的两个有效阻塞项均已修复：

1. 托管 Codex 的权限/effort 操作仍携带旧模型。分离模型选择与执行 context，增加真实 helper → writer 的陈旧 context 回归。
2. Stop 状态查询迟到覆盖新的执行事件。复用当前恢复/连接代际并记录执行观察变化，增加两种延迟响应与 SSE 交错的 DOM 回归。

桌面操作又发现四处遗漏，均在本轮修复并复测：

- Reset 返回成功时新 Session 尚未发布，立即创建当前会话 Task 被拒绝；只等待 metadata 的内存接纳仍不够。两种 adapter 复用现有 publisher + writer `flushForMutation`，以磁盘可见为成功边界，并使用各自既有执行快照 helper 保存真实模型、供应商和配置。回归覆盖真实隔离磁盘、延迟 IO、失败 IO 和重启所需字段。
- 未来 Task 被 Chat 提前标为 AI 输出，停止后残留加载状态。移除重复 loading 设置，由 TabProvider 的发送/实际执行事件负责。
- Channel 启动失败后列表静默报错，且只根据在线状态提供启动/停止，无法关闭已启用的异常渠道。列表和详情均按 enabled 意图或活跃连接提供停止，实际连接状态另行展示，失败刷新配置并显示现有 toast；缺凭据或插件只限制启动。
- Codex 预热时元数据没有模型，普通发送显式传入界面模型可以成功，但后端 Retry 只拿消息 ID，重放落回 CLI 默认模型。重试现在传递 model / reasoningEffort 两项发送意图，经同一个 adapter admission 执行；会话、Provider、权限和历史变更仍由既有后端 owner 决定。V1/V2 回归增加无模型预热，并断言实际执行模型/effort，已先复现失败再修复。消息虚拟列表另用现有 callback ref 在 layout effect 发布已提交值并做稳定转发，保证不重渲染的旧消息行点击重试时仍读取最新发送选项；DOM 回归先复现旧闭包及未提交渲染泄漏，再验证修复。

全部修复已通过 requirements / adversarial / architecture 三路独立审查及对应修复后的定向复核，冷恢复实机回归通过。复用已有 owner、锁和投影逻辑，没有新增事务框架、持久操作日志或重试队列。

## 自动验证

本轮各阶段按影响面运行，重复套件以最后一次结果计：**630 项 TypeScript 测试 / 28 文件、10 项 Rust 测试通过**。范围包含：

- Agent 字段意图、托管 provider context、Runtime 会话创建、Task hook、Channel 操作 UI。
- Stop/Reset DOM、迟到查询与 SSE 交错、会话标题恢复、发送输入组件。
- SessionEngine、Builtin / external adapter、真实隔离 SessionStore / writer、Fork remap、Rewind / Retry、旧历史兼容与外部 runtime 模拟集成。
- Rust TaskApplication 9 项、Channel 最新锁内配置写入 1 项。

`typecheck`、`lint`、测试分类检查、`cargo check` 和改动 Rust 文件的固定工具链格式检查通过。依赖检查仍有 12 个既有 orphan 警告、无错误；全仓 Rust 格式检查存在无关历史差异，未顺带格式化。macOS Rust 测试二进制使用 Xcode Swift runtime 搜索路径运行，未改应用构建配置。

最终代码已通过 `./build_dev.sh --build-only`，真实运行该产物进行下述验收。最后的 layout effect 调整后再次构建、冷恢复 Codex 两轮会话并重试第二轮，实际回复成功且第一轮完整保留。前轮曾单独验证 431 项 / 16 文件；本轮重跑其核心套件并按实际修复补充回归，不将前轮数字重复累加。

## 桌面验收

环境：macOS、开发版原生 App，独立测试工作区 `stability-acceptance-20260918`。通过实际 UI 操作与 accessibility / 截图检查验收，未用页面脚本代替操作。测试仅修改自己创建的 Agent、会话、Task 和合成无效凭据 Channel。

| 场景 | 实际结果 |
|---|---|
| 普通发送与保存恢复 | Builtin 真实模型两轮回复；重启恢复后两轮历史完整。 |
| Fork 与分支继续 | 新 Tab 分支成功；继续询问可准确引用两轮历史，原会话保留。 |
| Rewind、继续、Retry | 回溯删除选中轮及后续内容，恢复输入；再次发送成功；重试只替换目标轮，无重复。 |
| Stop | 长输出途中停止，输出终止、发送入口恢复。 |
| 新会话与重启 | 新空会话保留模型；重启恢复后无需重选模型，可正常得到真实回复。 |
| 当前会话未来 Task | Reset 后立即创建成功；等待触发时没有 AI 输出假状态；停止后恢复输入控制，Task 留在待恢复列表。 |
| Task 启动失败与成功 | 一次启动失败保留 Blocked 和错误；另一独立一次任务实际运行至已完成。失败由验收期间重建替换正在使用的可执行文件引起，不将其误记为随机产品故障；后续构建均先退出 App。 |
| Runtime 切换与真实 external 执行 | Builtin → Codex CLI 新建独立 Tab，磁盘默认值更新为 Codex；真实回复成功，Fork 后能引用原上下文，回溯后输入恢复并可继续。修复重试选项与旧行回调后，冷恢复历史直接 Retry 及保留前缀的第二轮 Retry 均成功，日志确认实际模型为 UI 所选模型。 |
| 配置单字段修改 | 选择托管 Codex 模型后调整 effort、权限，模型选择保持不变；陈旧多窗口 context 覆盖由确定性测试补证。 |
| Channel 故障与停用 | 合成无效 Telegram 凭据实际返回 Token unauthorized；列表显示错误 toast，异常状态仍可停止；列表和详情停止后均显示已停止，磁盘 enabled=false。 |

故障注入、迟到响应、并发写、损坏历史身份与 native 链边界由隔离回归验证，未通过破坏用户真实数据制造故障。有效 IM 账号的成功收发、全部外部 Runtime / Provider 组合及 Windows 不属于本机实测通过结论。桌面 smoke 与确定性测试互补，不能把模拟 runtime 通过写成所有实际平台通过。

## 后续前端调研：低风险组修复（F2 / F3 / F6 / F8）

范围来自前端全链路调研。发送接纳与草稿清理（F1）、关闭 Tab 后后台接管（F4）、执行 loading 归位（F5）、虚拟列表全量计算优化（F7）以及未确认候选项继续暂缓；本节不宣称这些问题已解决。

| 问题 | 最终处理与边界 |
|---|---|
| AskUserQuestion 失败丢卡片 / 卡在提交中 | Chat、MessageList 与 Companion 透传 requestId 和 Promise。后端明确返回 success=true 才清除对应问题；失败由表单保留答案、显示错误并恢复操作。表单以 requestId 管理本地生命周期，旧回执不清新问题。不增加自动重试或后端幂等承诺。 |
| Cron 迟到历史污染当前会话 | 删除独立 `/since` 查询和 append/fallback 链路。完成事件作为失效通知，复用 TabProvider 的 live-recovery，沿用 Session、restore token、connection generation 与 revision replay。恢复中的回溯事件按 revision 重放，旧连接快照不能覆盖新连接。 |
| Task UI 的迟到查询写入另一会话 / Task | Chat 的既有恢复 effect 提取为 `useSessionCronRestore`，清理时取消结果应用；两次读取结束后提交当前投影。useCronTask 的 Task 快照回执和回调只作用于原 Task / Session。TaskStore / scheduler 的生命周期和 Chat 既有 loading 规则未重构。 |
| 附件变化未触发消息刷新 | Message memo 使用完整的不可变 message 对象身份；删除不完整的字段比较。不变的消息对象仍跳过渲染，附件及其他可见字段的新对象正常更新。不引入深比较或新缓存。 |
| effect replay 后 SSE 不再连接 | TabProvider 每次 setup 恢复 mounted 状态，cleanup 释放连接和恢复请求；异步断开后不为已卸载页面新建订阅。保留现有连接串行和取消机制，不全局启用 StrictMode。 |

这些修复不改变正常操作入口、问答格式、存储格式或 Runtime 协议。网络失败时问答保留、Task 迟到结果丢弃、附件及时显示是预期纠错；必要的身份和恢复边界仍然保留。

验证包括主窗口与 Companion 的真实 hook/组件回归、HTTP reject / 200 false、旧成功回执遇到新问题、跨 Session Task 查询、Task 被替换、同 Session 回溯与连接 replacement、StrictMode replay / 未完成连接时卸载，以及消息行渲染次数。浏览器通过临时页面运行当前源码中的真实问答与消息组件，实际点击验证失败保留→成功重试、新问题隔离、附件添加/更新/移除；页面只用合成数据，验收后删除。

提交前完成 `build:web` 与浏览器组件验收；随后另行完成下述原生开发版验收。隔离的 IPC/SSE 回归不等于全部真实 Provider 或 OS 故障场景验收；前节原生 App 实测属于前一轮，不重复计作本轮证据。

本轮最终验证为 **255 项 / 20 文件**（163 项组件测试、92 项未受后续修正影响的单元测试），typecheck、lint、build:web 通过；依赖检查仅保留既有 12 个 orphan 警告。为排除共享工作区其他会话的 SDK/权限修改影响，将本轮 patch 单独应用于基线的隔离副本后，重跑了类型、lint、构建和完整相关组件测试。三路独立审查及针对性复核全部通过。

审查中删除了一处过严的停止回执限制：后端先发终态事件清空 UI，再返回停止成功，仍应保留成功的 Task 与 prompt 回执。只有“是否更新当前 Task 投影 / 展示恢复入口”检查归属，不能把正常终态清理误判为停止失败。另补了“切换后才收到旧 Task 事件”和历史 IM internalSessionId 的归属回归。没有以空对象、状态已清理或事件先后顺序为由阻断正常功能。

### 本组修复的原生开发版验收（2026-09-18）

基于代码提交 `9e76aa64`，先正常退出旧 App，再运行 `./build_dev.sh --build-only`，完整构建通过。使用 Codex 原生 Computer Use 操作 `src-tauri/target/debug/bundle/macos/MyAgents.app`，没有使用 cuse 或页面脚本代替桌面交互。测试继续使用独立工作区 `stability-acceptance-20260918`，附件和提示词均为合成验收数据。

| 场景 | 实际结果 |
|---|---|
| 真实问答提交 | Builtin / DeepSeek 调用 AskUserQuestion；选择蓝色并提交后卡片收起，模型回复“已收到：蓝色”。 |
| 新问题与取消 | 后续新问题的两个选项均未选择，提交按钮禁用；取消后卡片正常收起，后续发送可用。 |
| 图片消息 | 通过系统文件选择器上传合成 PNG，发送后消息显示缩略图；大图预览可打开和关闭，真实回复正常。 |
| Task 停止回执 | 创建当前会话的一次性未来任务，停止后出现恢复入口；点击后原始任务提示词完整回到输入框。 |
| 后台 Task 完成与会话隔离 | 重新创建一次任务，切换到 Codex 会话。任务按时完成；当前 Codex 历史未混入任务内容，返回 Builtin 会话可见一次完整任务消息和结果，没有重复。 |
| 两个 Runtime 的连接 | Builtin 与 Codex CLI 各自真实回复成功；切换期间 Task 倒计时和各自历史正确。 |
| 冷恢复与继续发送 | 正常退出、重新启动同一构建产物并恢复两个标签页；问答、图片、任务结果均保留，没有残留交互卡片或任务运行状态。继续提问后模型正确引用“蓝色”和 `NATIVE-0918`。 |

本轮创建的两个 Task 分别已停止、已完成，没有遗留运行中的测试任务。验收期间未增加产品代码、调试开关或保护分支。日志另见 SDK allowedTools / command_lifecycle 警告及一次通知中心网络同步警告，未阻断上述流程；本轮没有顺带修改 SDK 权限或通知逻辑。

原生验收覆盖主窗口实际流程；Companion 的失败重试、HTTP reject / success=false、旧回执遇到新请求、精确的 Task 事件交错、StrictMode replay / 连接未完成时卸载以及仅附件字段替换仍由前述确定性回归覆盖，未声称这些故障都在实机人为复现。正常图片上传通过也不替代附件对象替换的组件回归。

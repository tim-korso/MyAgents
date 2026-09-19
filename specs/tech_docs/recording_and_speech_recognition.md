# Recording and Speech Recognition

本文记录当前 Record 录音与本地语音识别实现中的 owner、资源生命周期和排障边界。用户可见的入口、布局、播放、转写、现场笔记和 AI 讨论以
[`../design/records_and_recording.md`](../design/records_and_recording.md) 为当前规范；本文不复制页面规格。

按任务定位：实时切句与延迟看“录制中转写 / 原轨时间与声学处理”，停止后处理看“录制中转写”的自动收尾条件及“Durable speech job”，效果回归看“质量验证”，安装失败看“用户模型包”及“排障顺序”。

## Owner 与进程边界

- `RecordStore` 是 `~/.myagents/records/` 下 text/audio Record、artifact、timeline、transcript revision、diarization projection、speaker override 与 export source 的持久权威。旧 `thoughts/` 只作为幂等迁移输入；迁移完成后产品不再双写。
- `RecordingManager` 拥有 App-global 唯一采集槽、设备流、Ogg Opus 归档、pause/stop/recovery 和录音期 wake lock。Renderer 与托盘只消费其 snapshot。录音控制命令的 revision fence 以 Manager 最近一次控制变更为下界、RecordStore 当前持久 revision 为上界；录音期笔记、Mark 或元数据写入可以推进全局 Record revision，但不能使同一 generation 的 pause/stop 失效。
- `SpeechRecognitionManager` 拥有 durable speech job、优先级队列、Worker generation、重试/取消/退出收敛，以及向 `RecordStore` 发布 transcript / diarization projection 的授权。
- `SpeechModelPackManager` 是 `SpeechRecognitionManager` 内的模型权重子 owner：只管理首次显式安装、已安装资源自动维护、校验、active revision 和移除，不拥有 job terminal 或 Record 内容。
- `LocalInferenceRuntimeRegistry` 只解析 App bundle 中经过 manifest 校验的共享 `onnx-cpu` identity；`LocalComputeCoordinator` 只授予重型推理 lease。
- `myagents-media-worker` 是单 workload、单 generation 的受管子进程。它不监听端口、不下载资源、不读配置，也不直接写 Record 或公开 artifact。

Renderer → Tauri 的普通命令属于控制面。Worker 使用私有 stdin/stdout framed protocol；live PCM 是有界 binary frame，控制与结果是有界 JSON frame。Worker 路径、模型路径和 transcript 不进入 Debug / unified log。

随 App 发布的 speech native bundle 由唯一入口 `scripts/prepare-native-inference.mjs` 构建。顶层 owner 在同一仓库锁内取得 exact target document prepared bundle 的 immutable ONNX Runtime descriptor，再交给 speech builder；speech 不读取当前 `document-processing/v1` 投影，也不复制 ORT。Sherpa 上游 archive 只展开 CMake 构建实际需要的根文件、`cmake/` 与 `sherpa-onnx/`，因此 Windows 构建不要求物化示例、移动端等无关目录中的 symlink。

## 产品控制面与投影

- Launcher 的 Chat/Record mode 共用输入主区域；text/audio Record 进入同一个任务中心列表。文字创建仍写 `RecordStore`，开始录音必须先取得 `RecordingManager` 唯一采集槽。
- audio Record detail 是单实例顶部 Tab。同一 `recordId` 只聚焦，不重复打开；持久 Tab snapshot 只保存 `id/view/recordId/title`，恢复前用 `RecordStore.get` 验证。Record 不存在时同一 Tab 退回 Record 列表；Tab 不拥有 Session/Sidecar，也不持久化录音 snapshot、播放 seek 或电平。
- active recording 的 pause/resume/stop、笔记与 Mark 都在详情页完成。待提交笔记在关闭 Tab、退出 App、安装更新重启前必须先 flush；失败则阻止该关闭动作，不能把输入框当持久 authority。
- capture fatal event 由同一个 `RecordingManager` operation gate 先关闭 archive/analysis admission、停止旧 session 并冻结媒体时钟，再 durable commit `DeviceGap`；gap 提交失败时不重开设备。随后以固定五次、500 ms 间隔重开 admission 时冻结的 exact `CapturePlan`。live boundary 建立失败只关闭后续实时 analysis，永久 Ogg archive 继续并在 stop 后走既有 backfill 收敛，不能跨 gap 拼接 VAD 状态。成功后沿同一 Record/generation 继续并在 lifecycle 记录 recovery；耗尽后走现有 `interrupted` safe settlement。恢复不会重新 preflight 当前默认设备、热接管不同 identity/格式，也不建立第二个设备 watcher。Renderer 的录音计时、笔记和 Mark 锚点只消费 Manager `mediaDurationMs`，不得用墙钟绕过 pause/recovery freeze。极端 settlement worker/manifest 失败时必须释放 exact generation 的内存槽，保留 durable `stopping/finalizing` 供既有启动恢复处理。
- 录音接纳后由 `RecordingManager` 独立持有 wake lock；获取失败不阻止录音，但 snapshot 与 lifecycle 保留 `RECORDING_WAKE_LOCK_UNAVAILABLE`，Record Detail 显示非阻塞警告。它只防止 idle sleep，不承诺合盖、用户主动睡眠、OS 强制休眠或断电期间继续采集。
- 没有 transcript 的历史音频在转录区域显示“开始转录”。只有用户点击后才调用 `cmd_speech_record_transcribe`；安装模型、打开详情或启动 App 都不会自动扫描历史 Record。
- 人工纠错只覆盖 speaker rename、merge 与 exact segment reassign。原始 transcript revision 保留，override 单独持久化并在 projection/export/search 时合成；不提供任意字词改写。
- `RecordStore::read_speech_projection` 在同一锁内读取正文与人物，`cmd_record_transcript` 返回成对的 `RecordSpeechProjection`。页面、export、search 与 `content.md` 共用段落归属：人工 reassign 优先；来源相符的半开区间中，已知至少两个人物为 multiple；已知不足两人且有实质 unknown 活动为 unknown；其余一人为 single，无人为 unknown。按人工 merge 后 canonical identity 计数，保留 ASR 原段落和真实同时发言，不切词或默认 Speaker A。Renderer 整体替换同一 processing/source snapshot 的结果。历史讨论文档和搜索复用既有重建入口，不增加扫描器。
- microphone/system 与人物是不同维度，每轨可有多人，同人可跨轨，麦克风不代表“我”。已知来源的原轨分别推理，再融合为当前 Record 人物与一份有序文稿。稳定人物 ID 独立于模型临时编号；匿名 `Speaker A/B/C` 按首次有效活动展示，真实旧 schema 保留旧字母。embedding 只在 exact Worker generation 内短暂存在并主动清理，不持久化或跨 Record 复用。
- audio Record 结束保存后，`RecordStore` 在 Record 根目录生成唯一的 `content.md` 当前态文稿，包含元数据、当前 speaker projection、转写、现场笔记与重点 Mark。它是可重建的派生 artifact：最终转写、diarization、speaker override、metadata 或 timeline 变化后原子覆盖刷新；录音中不生成，损坏或缺失时由 AI 讨论接纳入口按当前 Record revision 重建。Renderer、Session 与 TaskStore 都不维护第二份副本。AI 讨论仍以该文稿为主；`RecordStore` 同时返回经 artifact inventory 验证的实际音轨绝对路径，仅供 Agent 需要时核对原始声音。
- 托盘只消费 `RecordingManager` projection：录音中 icon 增加状态圆点，菜单出现“正在录音...”，点击打开 exact Record Tab。托盘不拥有录音状态或导航 history。
- SearchEngine 复用现有 Tantivy + jieba 建立 Record index；`RecordStore` change broadcast 驱动 upsert/delete，搜索按 `record_id` 合并 title/content/tag/transcript/speaker 命中，每个 Record 最多返回一项。
- analytics 复用 renderer `track()` 与现有 Tauri bridge，只记录 typed milestone、枚举、duration bucket 与不可逆 Record hash；不记录音频、transcript、speaker name、路径或自由文本，也不新建 endpoint/outbox/retry/store。

## 依赖复用边界

算法、codec 和通用格式能力优先复用成熟依赖；版本以 `Cargo.lock` 和 native manifest 为准。模块只保留 MyAgents-specific owner、授权、生命周期、固定内部 profile 和依赖无法表达的 hard limit：

- 重采样统一经过 `rubato` adapter；适配层只负责 interleaved/planar 转换、尾部 duration 对齐与 buffer hard limit，capture callback 不执行 DSP；
- attachment container/codec probe 与解码统一使用 `symphonia` 的产品白名单 features，不引入 FFmpeg 或第二个 runtime decoder；
- Ogg archive/test 与 bundled libopus 共享固定内部 profile。Worker reader 保留分配前 packet 上限、连续 page sequence 与 fail-closed 校验；
- Opus 浮点解码和附件 sinc 重采样允许产生正常的 full-scale overshoot；两条 decoder 都在输出边界将有限 PCM 限幅到 `[-1, 1]` 后交给推理。NaN/Inf 仍是解码错误，不能当作静音吞掉。
- sherpa 的 `max_speech_duration` 只是促使端点出现的软参数。native VAD adapter 按模型窗口喂入，基于连续 detected speech 预算强制 flush，并预留 onset lookback；静音、自然端点、pause flush 和 reset 清除预算，保证长段在达到 ASR 硬上限前形成有界结果。
- diarization 模型推理属于 sherpa-onnx，受控 source patch 暴露原始 chunk/slot 活动、独占干净语音与可缺失 embedding；局部和全局融合复用 native complete-link，无 HDBSCAN noise 吸附、第二个 embedding extractor 或固定人数假设；
- transcript revision 与 recording lifecycle 共享 `DurableRecordJournal` 的 regular-file、identity/schema、sequence/checksum、单行上限、durable append 与 torn-tail repair。

引入新 primitive 前应证明现有依赖无法表达关键约束；没有缺口时不保留双实现或 feature flag。

## 质量验证

模型质量 release pool 使用 `scripts/speech-quality-corpus-source-lock.json` 作为 corpus source of truth。它固定 AISHELL-1 普通话近讲、AISHELL-4 普通话远场会议、ASCEND 中英混说和 AMI 英文会议的 upstream revision、URL、bytes、SHA-256、许可证、选样窗口与完整 prepared manifest SHA-256；runner 不接受 prepared manifest 自行声明来源。cache/output 在下载前按物理路径拒绝仓库内目录及 symlink/junction escape，原始语料和带正文的 prepared manifest 不进入 App bundle、Git、日志或遥测。

准备入口 `scripts/prepare-speech-quality-corpus.mjs` 复用 native resource 的内容寻址下载与离线 cache，不实现第二套 downloader。Python工具链使用 PEP 723 + uv lock固定依赖与artifact hash；FFmpeg只生成确定性测试输入，不随App分发，也不改变产品解码与archive路径。工具或输出漂移必须使prepared manifest校验失败。

执行入口 `scripts/speech-quality-benchmark.mjs` 复用正式 batch/live client、Worker、native manifest、共享 ORT 和模型 manifest，不建立 benchmark-only 推理路径。runner分别测量Worker ready、VAD确认、stable final、CER/WER/DER与资源指标，并拒绝依赖terminal flush才完成的样本。长跑使用已校验snapshot的私有执行副本，报告只保存hash、model-pack revision、环境、计数、耗时、错误分解和rate，不保存reference、hypothesis或transcript正文。参数用法与质量门槛以该 runner 的 Usage 和 threshold 定义为准；具体测量结果属于 benchmark artifact，不写入架构文档。

## Durable speech job

job metadata 位于：

```text
<app-data>/speech-recognition/jobs/<jobId>/job.json
<app-data>/speech-recognition/private/<jobId>/...
```

Record 的整次处理以发起 backfill job ID 为 `processingId`，ASR 和 diarization 沿用既有 job 类型及各自 Worker generation；后台人工身份匹配在 diarization Worker 内完成。admission 固化原音频/时间映射、人工锚点、模型 manifest hash、共享 ORT identity 与算法 fingerprint。ASR 成功只写 Manager 私有候选，root 保持非终态；人物与身份 evidence 完整后才提交。重启保留 processing/job ID，清除旧 generation，依持久候选恢复阶段；已提交 Record manifest 可修复尚未 terminal 的 job。Agent job 在进程边界收敛为 `interrupted`。队列按冻结 snapshot 解析资源，active pack 的变化只影响新处理。

App-global compute admission 固定为 `RecordLive > RecordBackfill > RecordDiarization > AgentAttachment/DocumentOcr/SpeechModelValidation > BackgroundResourceValidation`，同优先级按 coordinator ticket FIFO。Speech 自己的 durable queue 在申请 lease 前也按同一 kind priority 选下一项，因此较晚到达的 backfill 不会被已经等待 lease 的 attachment 隐藏。只有 `RecordLive` waiter 会要求已运行 workload cooperative yield；其它优先级只裁决下一次 admission。speech batch/live 收到 yield signal 后立即向 exact generation 发 `Yield`，从信号时刻计 15 秒后 force-stop，job ID 保持不变并以新 generation 重排。

Capture admission 与 live 推理收尾不是同一生命周期：已经收到 finish 或 cancel 的旧 Record registration 不占用下一段录音的 admission；仍在录制或暂停的 registration 继续互斥，同一 Record 不得重复注册。旧 generation 完成收尾前仍持有原 compute lease，后继 live workload 经同一 coordinator 排队，不并行加载第二份 live 模型。暂停 flush 的 exact acknowledged boundary 保存在该次 LiveControl 内；Stop 边界已获确认时直接结束 journal，无论是否恰好处于模型卸载的前后，都不为结束动作新建 generation。仅收到 PCM ACK 或 replay checkpoint 不算 flush 确认，恢复后新增尾音仍需处理。

Worker settlement 统一有界：合法 `Completed/Failed` 后最多给 30 秒自然退出；`Yielded`、本地 protocol/cancel 路径先给 15 秒 cooperative settlement；App shutdown 给 10 秒；任何路径进入 force-stop 后最多再等 10 秒确认 exact process tree 已无法执行。Manager 在 settlement 完成前不释放 generation/publish authority。

Worker 结果只有同时满足 exact `(jobId, generation)`、协议 shape、业务数量/时间轴上限且当前 generation 仍持有 publish authority 时才能提交。Record ASR 成功后由同一 Manager 排队 diarization；stale generation、cancelled generation 和失败 probe 都不能发布内容。

只有真实 legacy mixed artifact 才作为一个 mixed 来源推理；已知双轨结果保留 microphone/system。普通 stereo 附件不能被猜成物理双来源。live PCM、InputAck 和物理轨 checkpoint 不接受 mixed。身份 evidence 在说话人批次结束后，按冻结人物集合完整、有序、分批返回；shape/顺序/代次错误是任务失败，不是低置信弃权。回归经过实际 framed protocol 和 Manager 接收路径。

Record 最终 transcript 与 diarization 结果先以唯一 UUID 文件名写入对应目录并同步，再由 `record.json` 原子接纳其 artifact；当前已引用文件不提前覆盖。提交失败仅在磁盘清单证实未引用时删除该次文件，提交成功后清理上一份已拥有的结果。读取兼容旧 `transcript/snapshot.json`、`diarization/result.json`；旧版半提交造成的失配引用在加载时降级为待重试的 failed projection，同步失效引用这些结果的讨论文档，原始音频保持严格校验且不被派生结果故障隐藏。未入清单的旧结果不自动接纳，显式重转直接生成新的结果。

失败 job 保留最后确认的处理 stage；失败收尾不再一律将 stage 改成 `publishing`。Record 详情通过现有 `cmd_record_get` 从 SpeechRecognitionManager 的最新 backfill job 投影结构化失败原因，Record manifest 不持久化第二份 job error。协议读帧拒绝只记录固定原因枚举、job/generation 与 IO kind，不记录响应正文或原始 stderr。

正常收尾也记录 `[speech]` 元数据日志：live finish request / settlement，以及 Record job queued / started / worker-ready / stage-change / worker-completed / terminal。仅含 Record/job/generation、枚举、样本与结果计数、排队/总耗时和 Worker 耗时；不输出音频、正文、人物名、模型或文件路径。排查等待时间时按这些阶段区分 live 追赶、资源排队、全文整理、人物处理与发布，不能把端到端等待等同于模型推理耗时。

正文与人物的 UUID 候选由 Store 在同一锁内原子接纳为兼容的 artifact 对，并重读最新人工事实后裁决继承。重跑期间旧 final（包括 ASR-only final）继续可读；失败或取消保留旧稿。只有从未有 final 且 ASR 已成功时，人物计算失败可以发布 unknown 正文并保留真实错误；提交失败不适用该例外。取消、删除与恢复按整次 processing 收敛，私有候选不取得展示权。 Publishing metadata 写失败须进入既有失败结算。终态写盘失败不能让已退出的执行者继续显示 Running：Manager 仍更新当前终态、结算子任务并清理私有候选；重启以 Store 已提交 processing 结果或既有失败/缺失候选事实收敛。失败意图未持久化时不发布首次 partial final，错误记固定日志，不新增重试队列。

### 稳定人物与人工锚点

人工姓名、merge/reassign 与原始音频区间由 Store 持有；模型标签和自动继承关系属于该次结果。首次显式操作或 legacy 首次重跑时绑定原始事实，后续改名不从自动继承的新模型重建人工证据。merge 保留各原身份的 `identityScopes`：各组成身份分别核验后恢复人工关系，不重新要求用户已合并的声音证明为同一声纹。 已迁移段落改派仍校验原操作 revision 和范围，但旧绑定与当前目标须经过同一最新 merge 关系解析，之后显式合并不能让有效人工修正丢失。

段落改派从身份比较双方屏蔽，再独立按原始区间投影；新操作只替代实际覆盖的旧 scope，未覆盖部分保留，被替代部分以后不得复活。发布在锁内裁决最新 human revision；运行中的新 merge 只能组合已经验证的原组成证据。

Worker 复用同一 native diarizer 从原轨提取有界锚点，以瞬态向量验证声音、双向时间覆盖、竞争者距离和独立干净区间。Worker 不接收姓名，也不持久保存声纹向量；人工姓名由 Store 保存。Store 与 Worker 共用 protocol 的接受规则。证据不足时旧标注保留但不作用于新稿，不返回冲突清单、概率或强制核对任务。数值门槛须经独立会议校准，单测不证明匹配质量达标。

### Agent attachment job scope

`myagents speech transcribe/status/wait/cancel/list` 是给 AI 使用的 Session-scoped 工具面。CLI 不接受 Session、Workspace 或 Sidecar scope 参数；Node 从当前 `SessionEngine` 和进程环境取得 Sidecar identity，Rust Management API 用 request header 中的 generation 回查同一 live process 的 authoritative `product_session_id + workspace_path`。job admission 自动冻结这两个字段。

输入必须是该 Workspace 内已存在的普通文件，拒绝 URL、symlink、逃逸路径与不受支持格式。默认输出根为 `<workspace>/myagents_files/speech-transcriptions`，发布仍使用 private staging + authenticated owner marker + no-replace rename；partial 结果不可见。status/cancel/list 都按 exact caller Session 过滤，所以其它 Session 即使知道 job ID 也得到 `SPEECH_JOB_NOT_FOUND`。Agent job 的可见历史保留 30 天；App 重启时非终态 Agent job 收敛为 `interrupted`，不会静默继续使用旧 caller generation。

## 录制中转写

资源在录音 admission 时已 ready 才会接纳 live workload；缺资源的录音只做权威 Ogg Opus 归档。模型包后续安装只改变 capability，不扫描或自动排队这些历史 Record。

每个 physical track 的 callback 经一个固定 fan-out 先写 archive ring，再写可选 analysis ring。ring 的单次读取边界不保证落在 interleaved channel frame 边界；两个后台 writer 共用的 streaming `rubato` adapter 必须跨读取保留未完整的 source frame，只允许在整条输入结束时拒绝真正残缺的 frame。analysis 每个物理来源只落一份固定路径的 16 kHz、至多 stereo raw PCM16 spool；通道、源帧和 Record 时间位于既有 metadata/protocol，不自创媒体容器。`SpeechRecognitionManager` 只读取已 `flush + sync_data` 的 committed sample，逐个有界 binary frame 发给 exact-generation Worker，并校验 ACK、heartbeat checkpoint、segment revision 和 terminal metrics。Worker response 使用 bounded reader channel 和 120 秒基础设施超时；超时只重启当前 live generation，不影响 archive。

活跃录音中的单路开关仍由 `RecordingManager` 持有：它不热换设备、`CapturePlan` 或 source identity，只令对应 archive/analysis sink 在原回调时序中写入等长静音，并把该路电平归零。这样重新打开后继续同一 generation，双轨、transcript 与笔记共用的媒体时间线不会因关闭一路而压缩或错位。完成态若同时存在 microphone/system 而没有持久 `mixed` artifact，Renderer 直接同步播放两条 Range 数据流形成默认混合监听；单轨选择仍只播放对应物理轨，不为播放额外引入 mixer 进程或派生文件。

Pause 先关闭 Manager 媒体 epoch 并等待 callback 的 archive/analysis fan-out 完成，再关闭 ring admission 并暂停设备。Sink 发布屏障保证预留源帧已完成 PCM/metadata 发布，不能把异步平台 pause 当作 callback drain。恢复时按完整 source frame 裁剪已知旧采集时间，只保留新 epoch 内的样本；analysis writer 排空、刷新 resampler 并 fsync 后，Manager 以每轨 exact sample boundary 发送 `Flush`。Worker 在该边界强制结束 VAD 句段、发布稳定整句并重置 VAD，不写虚假静音，也不把 wall pause 算入媒体时间。暂停不足 10 分钟时保留 live Worker、ASR/VAD session 与 `RecordLive` lease；连续暂停达到 10 分钟后，pause epoch fence 允许 exact generation 用 `Yielded` checkpoint 退出并释放模型/lease。Resume 会使旧 timer 失效；若 Worker 已卸载，则从同一 append-only spool 与 durable transcript journal 的 exact offset 创建新 generation，卸载不消耗 crash retry budget。暂停中 Stop 在已 flush boundary 直接收敛 live journal，不为结束动作重载模型，永久 Ogg 与后续 backfill 不受影响。

live revision 写入 `transcript/revisions.jsonl`，复用 `DurableRecordJournal`。Worker-local ID 不成为产品 identity；RecordStore 按 `track + start + end` 生成稳定 segment ID，同边界重算只递增 revision。generation 失败时按 Record 推理安全前沿映射回原轨，并回读有界 DSP 历史，重建 AEC/VAD 和未成句语音；已发布区间不重发。source frame ACK 仅证明传输接纳，不代表 Record 时间或推理完成。

Capture timeline 的增长可能细化已观测区间的时钟斜率；不同 snapshot 映射出的相邻 transport frame 起点因此可以略有差异。LiveSource 以连续 source sample 和 capture 提供的 discontinuity / Gap 判定声音是否连续，把新映射接到已接纳的 Record frontier，再以现有 resampler 校正尚未处理的区间；校正区间标为 estimated，不能因时间估计变化 flush/reset VAD。真实 source 缺口、pause 与 capture discontinuity 仍保留边界；final 使用冻结后的完整 timeline。

Stop 先停止并落盘 capture/archive/analysis，再提交永久 Ogg artifact；archive 结束时必须编码足以覆盖 source media 与 Opus pre-skip 的最小尾包，异常恢复把最后 checkpoint 收敛到其真实可解码的 EOS granule，不能把尚待后续 packet drain 的 lookahead 发布成媒体时长。只有本次录音在开始时已接纳 live workload，才会用最终 analysis boundary 收敛 live Worker，并自动为永久 Ogg 接纳 recording-final backfill。最终 backfill 与 live 共用来源/时间/AEC 预处理；原轨分别 VAD/ASR，共享一份 ASR 模型；复用与 live 相同的每来源 stateful VAD 实现，每个 workload/generation 独立创建实例（含 Silero 模型），按媒体时间稳定汇集原段落，保留短应答、真实重叠和重复发言，不凭文字相似去重。stop 命令返回的终态 snapshot 只是 operation receipt，不再拥有 RecordingManager slot；Renderer 释放该 owner 后由 RecordStore 的 final-transcript `upsert` 重新读取并替换 live projection。analysis 失败不把可用音频判坏。异常退出恢复只清理 Record 内两个固定 spool 文件；只对 manifest 表明此前已经接纳 live transcription 的 interrupted Record 恢复 backfill，普通历史录音保持手动“开始转录”。

## 原轨时间与声学处理

CPAL 的时钟转换按 device stream 校准一次，再使用该 stream 的 capture timestamp 差值推进；回调到达时间只用于首次跨时钟定位，不能逐次重新作为采集时间，否则调度抖动会被误标为真实 clock gap。暂停期间保留同一 stream 的校准，设备重开创建新校准；原生时钟中的真实间隔仍交由既有 capture epoch / timeline 处理。

原始 Ogg 是回放和重算权威。RecordingManager 将 CPAL capture timestamp / SCK PTS 映射到自身单调媒体时钟，持久保存有界的原样本到 Record 样本 spans，区分 clock、estimated、gap 与 discontinuity。暂停冻结媒体时间，来源开关与归档 overrun 保留有位置的缺口；Opus pre-skip/EOS 和 resampler/DSP 延迟都回到该坐标。没有可靠时钟的旧区间不能取得跨来源高置信 authority。

`record_timeline` 是推理/迁移的坐标契约；Renderer `recordPlayback` 使用同一份 parity fixture。合听直接播放两条原轨，按 Record clock 同步 seek/rate；leading gap、来源缺口与单轨提前结束不压缩总时间，不生成永久 cleaned PCM 或混音文件。

live/final 共用来源、时间与回声预处理。Media Worker 使用 Sonora AEC3，只对麦克风应用 AEC，系统轨作参考并保留；参考缺失或时钟不可靠时保守 bypass。外部仍接收 10 ms 帧，内部复用库的 FrameBlocker/BlockFramer，把媒体时间对应的 64 sample render/capture 块依次送入 BlockProcessor；保留必要 HPF，不开启 AGC/NS。未建立可用线性回声路径时，默认路径增益为 0，避免仅因系统播放活跃便压低耳机中的本地语音；已学习路径的残余回声估计仍启用，收敛期间不确定的回声不能算消除成功。回声传播延迟与采集时钟偏移是不同事实，128 sample 帧处理延迟由上层 drain/映射补偿，不得移动本地人时间。只有原始 mic、参考、清理后各声道均具备可靠波形/时间证据时才标记 echo-only；ASR 跳过前 flush/reset，diarization 提取声纹前排除。短近端、双讲和不确定观察保留，不能按远端活跃静音 mic。

原始活动、身份建模与弱证据归属分开：当前至少 2 秒模型预测独占语音才参与局部 complete-link 和中心/witness；该时长是待真实语料校准的资格参数，不表示模型已证明单人纯度。较短有效向量只向固定建模组尝试归属，要求所有成员距离低于同一 cut、与最近竞争成员保持至少 0.10 间隔且无活动冲突；不更新中心/witness，不通过弱观察串联人物。两个同时活动的弱槽位若竞争同一身份，则都保留 unknown。已归属的独占活动仍传播同源/跨源不能合并约束；缺向量、歧义和无可靠建模组均保留 unknown。窗口 ownership 只去除重复权重；上下文有活动而主窗口缺失时，按各 native chunk 最大同时活动数补 unknown，不叠加重复窗口票数。并发 unknown 不是同一人物，不能按 `(source, None)` 合并。可靠同源槽位重叠及跨源独占活动建立不能合并约束，complete-link 不能经第三人物绕过它；可靠 echo-only 在此前排除。

局部融合窗口为 300 秒、相邻重叠 11 秒；模型仍按 10 秒 chunk 推理。每窗最多 192 raw observations / 32 local prototypes，两来源共用 2048 global prototypes 上限。窗口长度须同时约束原始证据和整场候选密度：沿用旧 68 秒窗口会让五人八小时录音在约 6.5 小时耗尽全局预算。当前参数使八小时每来源约 100 窗，无需扩大全局距离矩阵或以强行合并换内存；异常碎裂等超限仍明确失败，不截掉末尾、不丢少数人物。

## 用户模型包

模型资源不按操作系统或 CPU 架构分片：macOS arm64/x64、Windows x64、Linux x64/arm64 共用同一份 source lock、签名清单和 ONNX 模型文件，一次 R2 模型发布覆盖全部五个构建 target。平台差异属于随 App 打包的 Media Worker、speech native adapter 与共享 ONNX Runtime，由各 target 的 native preparation/build 处理；模型发布脚本不发布这些二进制。公网资源校验通过只证明下载内容就绪，各平台安装、实际模型加载和录音行为仍需在对应客户端验收。

当前下载目标 pack identity 固定为 `local-standard-speech / local-standard-speech-v3`。pyannote segmentation 3.0 使用同一已锁定上游 archive 中的 FP32 模型：分段漏检会使后续声纹匹配无从归属，不能靠放宽聚类距离修复。SenseVoice、Silero 和 ERes2Net 不变，source 下载字节数不变，安装体积增加 4,452,407 字节；模型文件与 pack revision 一起更新，不覆盖已发布 v2 的身份。编译期 source lock 位于 `src-tauri/media-worker/model-pack-source-lock.json`，固定：

- 四项第一方镜像 asset 与各自 URL、upstream revision、size、SHA-256、格式和许可；
- 五个实际推理文件的 archive source path、安装相对路径、size 与 SHA-256；
- 五份 legal artifact 的 remote/archive 来源；
- 总下载预算和 300 MiB 硬上限；
- App updater 同一 Minisign trust root 与 detached signature 要求。

远端发布面固定为：

```text
https://download.myagents.io/models/speech/sets/<pack-revision>/manifest.json
https://download.myagents.io/models/speech/sets/<pack-revision>/manifest.json.sig
https://download.myagents.io/models/speech/assets/sha256/<sha256>/<filename>
```

远端下载 manifest 的原始 bytes 必须通过 detached Minisign 签名验证，并与当前编译下载锁做完整 typed identity 比较。执行兼容性由 App/Worker 共享的 `model_pack_source.rs` 裁决：当前 v3 与明确保留的已发布 v2 完整锁都可执行，绝不把任意已签名远端清单当成兼容许可。JSON 排版和 CRLF/LF 不参与资源身份；任一字段值、字段集合或数组顺序漂移都会被拒绝。验签后的原始 bytes 原样写盘并由 active pointer 固定其 SHA-256 与签名，因此远端 JSON 仍不能提供新的本地路径、host、模型或 native library。

发布 owner 是根目录 `publish_speech_model_set.sh`：它先调用 `scripts/prepare-speech-model-mirror.mjs`，将运行时 source lock 与 release-only `model-pack-mirror-origin-lock.json` 按 exact asset/legal ID join，复用 `acquireLockedResource` 的 content-addressed cache 从锁定 GitHub origin 取得并校验七个 source。publisher 先补传缺失的 content-addressed object 并逐个从公网完整回读比对，再调用 `scripts/package-speech-model-set.mjs` 原样复制编译 source lock、复用 Tauri updater signer 生成 detached signature，最后发布 manifest/signature。任何已有 source/manifest 内容漂移或签名失配都 fail closed，不接受 force、revision、asset、URL 或 trust-root 覆盖。GitHub origin lock 不进入 App 运行时；完整 source lock 语义仍由 Rust/Worker 的同一解析与测试裁决。

持久布局：

```text
<app-data>/speech-recognition/models/
  active.json
  packs/pack-<activation-uuid>/
    manifest.json
    activation.json  # 此 immutable pack 的原始签名 activation receipt
    models/...
    legal/...
  private/.download-<operation-uuid>/
  private/.staging-<operation-uuid>/
```

`active.json` 是小型原子指针，不使用 symlink；它保存 schema、pack revision、exact directory name、manifest hash、原始 manifest signature 和 activation time。pack 目录名只接受 `pack-` 加 32 位 UUID hex。

## 安装与激活顺序

1. 首次由用户显式调用 install；成功安装后以已认证的 `active.json` 作为维护资格。与 managed-codex 相同，每次 App 启动在延迟完整校验后自动尝试一次目标更新，失败下次启动再试；target 来自随 App 发布的锁，没有远端 latest 通道或 status-triggered 下载。自动维护与手动 install/remove 在同一 operation 锁内裁决。移除后不再自动下载。
2. 校验随 App 发布的 media Worker、native manifest 与共享 ORT 都是普通文件。
3. 从固定第一方地址取得 manifest/signature，对下载到的原始 bytes 验证 updater Minisign trust root，再验证其 typed source-lock identity；验签后的原始 bytes 在后续流程中保持不变。
4. 顺序下载锁定 asset 到 0700 private 目录中的 0600 `create_new` 文件；每个响应只允许 HTTPS `download.myagents.io` 固定 host，逐 chunk 执行 exact size、SHA-256 与总下载硬上限。
5. Rust 内置的 pure-Rust bzip2 decoder + tar reader 只选择 source lock 白名单文件。archive 中任意 traversal、重复路径、symlink 或 special entry 都让整个 staging 失败；运行时不调用系统 tar、Python 或用户 PATH。
6. manifest 最后写入；Manager 在安装与激活边界要求磁盘 manifest 的原始 SHA-256 与 pointer 一致、原始 bytes 通过 pointer 中的签名验证，并与对应可执行兼容锁保持完整 typed identity；逐项重开模型与 legal 文件校验 regular file、无执行位、size 和 SHA-256。后续 App 启动只同步恢复签名 pointer、已签名 manifest 与文件元数据；等首屏和 Global Sidecar 启动后 10 秒，再用最低优先级、chunk-level 可让路的 `BackgroundResourceValidation` lease 完整校验 pack。该后台检查期间已激活 pack 仍可被语音功能使用，失败后才撤销内存 active 并投影 repair 状态。同步 live admission 不重复读取整个 pack；Worker 每次实际执行仍独立重开并校验 manifest 的 typed identity、模型与 legal 文件后才加载模型。
7. 安装/升级的显式验证取得 `SpeechModelValidation` compute lease，让当前随包 Worker 依次真实创建并释放 ASR、VAD 和 diarizer engine。只有 Record live 到达时才 cooperative cancel exact probe tree、释放 lease 后重试；其它 workload 只影响下一次 admission。
8. staging 以 no-replace directory rename 发布到唯一 pack 目录，先为旧、新 pack 保存包含原始签名的 immutable `activation.json` receipt，再 atomic replace 根 `active.json`。旧 v2 安装首次升级时从其已认证 active pointer 补存 receipt；receipt 不决定默认版本，只供旧任务按冻结 revision 解析，读取仍验签并匹配完整兼容锁。rename 前明确失败会删除新 pack并保持旧 pointer；rename 已可见但 parent-directory sync 失败时绝不删除 pointer 已引用的 pack，状态保留新 active 并报告 `SPEECH_RESOURCE_ACTIVATION_DURABILITY_UNCONFIRMED`。

目标版本与可用版本分离：检查、下载、更新失败都不撤销健康的兼容旧版；新版完整校验并原子激活后，新 admission 使用新 active，已有 `SpeechPipelineSnapshot` 按 revision 解析保留的旧 pack，跨 Worker replacement 与 App 重启不改变版本。旧目录沿现有保留策略直到用户移除，不在更新期间删除或覆盖。真正损坏或不兼容的资源仍不可执行。

安装成功只改变 capability；不会扫描历史 Record，也不会自动创建 backfill job。历史音频必须由用户点击“开始转录”后才进入 admission。

## 移除、恢复与安全

- 任何非终态 speech job、active job 或 retained Worker 存在时，remove 返回 `SPEECH_RESOURCE_BUSY`。
- remove 先撤销 exact `active.json`，再只枚举并删除严格 `pack-<uuid>` 命名的普通目录/链接；未知文件或目录保留。即使 active pointer 已损坏，用户仍可安全移除已识别的 App-owned pack。
- 启动清理只处理 `models/private/` 直系、普通目录且以 `.download-` / `.staging-` 开头的 abandoned operation；不按扩展名或递归扫描其它根。
- pack 缺失、签名/manifest/file 漂移或 execute bit 出现都 fail closed；不会回退系统模型、在线 ASR、用户 cache 或第二份 ONNX Runtime。
- App shutdown 先取消资源 operation 并终止 retained probe process tree，再撤销 speech job 的 publish authority并收敛其 Worker。

## 状态与错误

Tauri 提供 `cmd_speech_model_pack_status/install/remove`。状态为 `not_installed | checking | downloading | verifying | installing | removing | ready | update_available | error`，另带 `usable`、active/available revision、公开资源字节数与结构化 `lastErrorCode`。只读 status 只检查本地 owner，不联网；显式安装依次投影第一方清单/签名核验、固定资源下载、安全解包与文件校验、真实模型加载及原子激活，只有下载阶段展示 bytes/百分比。App 目标 revision 变化后，已认证且兼容的旧 pack 投影 `update_available` 且 `usable=true`；更新失败可投影 `error`，但仍保留 `usable=true`。当前可用资源的 UI 不因后台维护出现安装按钮、进度或更新失败弹窗；显式移除失败及 durability warning 仍可操作。损坏或不支持的 pack 不可用，伪造 pointer 不授权自动下载。

这些状态只是现有 `SpeechModelPackManager` operation 与持久 pointer 的投影，不是新的持久状态机。Renderer 在操作期间轮询同一 command；没有第二套 downloader、事件 owner、安装授权或错误 store。主要错误族：

- `SPEECH_NATIVE_RUNTIME_UNAVAILABLE`：随包 Worker/native/shared ORT 不完整；
- `SPEECH_RESOURCE_NETWORK`：固定网络路径不可用或跳转 host 不允许；
- `SPEECH_RESOURCE_MANIFEST_INVALID` / `SPEECH_RESOURCE_SIGNATURE_INVALID`：发布 manifest 或签名不可信；
- `SPEECH_RESOURCE_DOWNLOAD_INVALID` / `SPEECH_RESOURCE_ARCHIVE_INVALID` / `SPEECH_RESOURCE_PACK_INVALID`：下载、archive 或安装 inventory 漂移；
- `SPEECH_MODEL_LOAD_FAILED` / `SPEECH_MODEL_LOAD_TIMEOUT`：真实最小加载未通过；
- `SPEECH_RESOURCE_BUSY`：并发 mutation 或仍有 workload 引用资源；
- `SPEECH_RESOURCE_CORRUPT`：active pointer / pack 的持久校验失败。

日志只记录 operation、revision、公开资源 bytes、generation、阶段与结构化错误码；不得记录用户音频、transcript、完整路径或远端原始错误正文。

## 排障顺序

1. 按 [统一日志的证据选择顺序](unified_logging.md#故障排查) 定位报告机器与时间，搜索 `[record]`、`[recording]`、`[speech]` 与结构化错误码；不要要求用户上传音频或 transcript。
2. 录音无法开始时先区分 `RECORDING_MICROPHONE_PERMISSION_REQUIRED`、`RECORDING_MICROPHONE_UNAVAILABLE`、`RECORDING_SCREEN_PERMISSION_REQUIRED`、`RECORDING_SYSTEM_AUDIO_UNAVAILABLE`、`RECORDING_PIPEWIRE_UNAVAILABLE` 与 `RECORDING_DEVICE_CHANGED`。macOS 麦克风授权依赖 `Info.plist` 用途说明与签名产物中的 `com.apple.security.device.audio-input` entitlement；缺任一项时 TCC 都可能在弹窗前拒绝。entitlement 变更后必须重新构建并启动新的 `.app`，前端热重载不会改变旧进程的签名能力。权限或设备问题由平台 capture backend 处理，不通过重装模型修复。
3. 音频已保存但没有转录时查看 Record 的 transcription status 与模型 pack status。资源未 ready 时安装/修复资源；历史 Record 仍需用户手动点击“开始转录”。
4. Agent 看不到 job 时必须在原发起 Session 运行 `myagents speech list`；不要通过增加 `--sessionId` 或全局 list 绕过隔离。
5. 资源准备或安装失败时依次核对 target native manifest、共享 ORT identity、第一方 manifest/signature、pack 文件 hash 与最小真实加载。不得回退系统 ORT、在线 ASR、用户 cache 或临时下载。

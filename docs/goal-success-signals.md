# 终止条件手册：源码构建产出可用的 MyAgents 构建物

## 目标

在**不复用已安装 app 任何资源**的前提下，从 `src-tauri/resources/` 为空起步，
由仓库自身的 prepare 入口编译/准备全部原生与预构建资源，产出一个签名自洽、
能在本机装入 `/Applications` 并正常运行的 `MyAgents.app`。

领域裁剪说明：本项目是**构建交付**而非产品功能开发，因此 pm-goal 的通用 8 领域中，
「C 体验/画面」与「E 数据/指标/平衡」不适用（UI 与数据行为由上游源码决定，
不是本次交付变量）；「G 评审/Gate」落成机器可验的资源指纹与签名校验；其余保留。

## 验证入口

```bash
npm run goal-check        # 产出 data/goal-check.json
```

## 终止条件

### A 交付物/资产

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| A1 | `.app` 产物存在且为 arm64 | `file` 主可执行文件含 `arm64` | L0 |
| A2 | 七项资源目录非空且无 `.gitkeep` 占位 | 逐目录统计文件数 > 1 | L0 |
| A3 | `document-processing/v1/manifest.json` 与 `speech-inference/v1/manifest.json` 存在且可解析 | 读取两个 manifest 的 `files` 数量 > 0 | L0 |
| A4 | 产物版本号为 0.4.20 | `Info.plist` 的 `CFBundleShortVersionString` | L0 |
| A5 | 资源来源为源码构建而非复用外部 app | `data/build-provenance.json` 记录 prepare 入口与缓存命中状态 | L0 |

### B 功能完整性

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| B1 | 全局 sidecar 启动并监听 31415 | `curl /health` 返回 `status=ok` | L0 |
| B2 | 就绪与功能健康检查通过 | `curl /health/ready` 与 `/health/functional` 均 200 | L0 |
| B3 | 前端已挂载 | 日志出现 `stage=react-commit` | L0 |
| B4 | 文档处理资源可被运行时校验通过 | 对 manifest 逐文件核对 sha256 与 size，全部匹配 | L0 |
| B5 | 语音资源可被运行时校验通过 | 同上，对 speech manifest 核对 | L0 |
| B6 | 会话能力可用（session sidecar 能接受请求） | `POST /api/browser/view/token` 抵达 handler（非 404） | L1 |

### D 性能/质量/可靠性

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| D1 | 启动无 ERROR/panic/崩溃 | 启动时间窗内 unified log 无对应级别记录 | L0 |
| D2 | 进程启动后保持存活 ≥60s 且内存无异常增长 | 运行 60s 后主进程仍在，RSS < 2GB | L0 |
| D3 | 无签名失效导致的加载失败 | 日志无 `LOCAL_RUNTIME_INVALID` / `code signature` 拒绝 | L0 |
| D4 | 构建脚本自身的单元测试通过 | `npm run test:build-scripts` | L1 |
| D5 | 类型检查通过 | `npx tsc --noEmit` 返回 0 | L1 |

### F 自动化/可观测/可演示

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| F1 | 一条命令可产出验收数据 | `npm run goal-check` 返回 0 且写出 `data/goal-check.json` | L0 |
| F2 | 构建过程留痕可追溯 | `data/build-provenance.json` 记录各资源 prepare 命令与耗时 | L1 |
| F3 | 复现步骤文档化且过 The One Test | `docs/build/` 下的重建说明可被无上下文读者照做 | L1 |

### G 评审/Gate

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| G1 | `.app` 签名自洽 | `codesign --verify` 通过 | L0 |
| G2 | 签名身份非 ad-hoc（TCC 可持久识别） | `codesign -d -r-` 输出不含 `cdhash` | L0 |
| G3 | hardened runtime 已启用 | `codesign -dv` 的 `flags` 含 `0x10000(runtime)` | L0 |
| G4 | 签名链完整 | `codesign -d --verbose=4` 含 Apple Root CA | L1 |
| G5 | 无 Developer ID 时的公证失败已被显式记录而非隐瞒 | `docs/decisions/` 记录该限制与后果 | L1 |

### H 上线/扩展

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| H1 | 已装入 `/Applications/MyAgents.app` 并从中启动成功 | 进程路径前缀为 `/Applications/MyAgents.app` | L0 |
| H2 | 前次 ad-hoc 产物已备份可回退 | 备份目录存在且 `codesign --verify` 通过 | L1 |
| H3 | 官方原版仍可回退 | `~/MyAgents-official-0.4.20.app` 存在 | L1 |

### L2（stretch，不阻塞 MVP）

| # | 条件 | 验证方式 | 层级 |
|---|---|---|---|
| X1 | 双架构（arm64 + x64）产物 | x64 产物存在 | L2 |
| X2 | 公证通过（需 Developer ID） | `spctl -a` 通过 | L2 |
| X3 | 自动更新签名就绪 | `TAURI_SIGNING_PRIVATE_KEY` 配置且 `.sig` 生成 | L2 |

## 禁止提前完成的信号

以下情形**不算**完成，出现即视为未达标：

1. **复用已安装 app 的资源**充数——manifest 摘要能过，但来源不是源码构建（违反 A5）。
2. **只签主 bundle、资源用外部字节**——A2/A5 会暴露 `document-processing-cache` 为空却资源齐全。
3. **`.app` 存在但 `codesign --verify` 失败**——仅凭「文件在」宣布完成。
4. **启动时用 `open -a` 成功但未验证健康检查**——窗口出现不等于 sidecar 就绪。
5. **把 `spctl rejected` 解释为成功**——无 Developer ID 时它是预期结果，必须显式记录为限制。
6. **跳过 goal-check 直接宣布完成**，或手工修改 `data/goal-check.json`。
7. **用上游源码已有行为冒充本次改动**（历史教训：P0-A/P0-B 曾被折进基线提交而无法单独审计）。

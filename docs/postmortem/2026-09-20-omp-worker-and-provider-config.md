# 复盘：MCP 接入被三处环境假设卡住

## Executive summary

把 omp-worker-mcp 接进 MyAgents 需要同时满足三个条件，其中两个的失败表现
都与真实原因无关：一个 provider 文件因扁平结构被静默跳过（用户看到的是
「provider 不见了」），以及宿主注入的 `PI_CODING_AGENT_DIR` 把 OMP 重定向到
错误的配置目录（用户看到的是「API key 无效」）。

持久教训：**当外部工具报「凭据无效」时，先确认它读的是哪个配置文件**。
本次两次「key 失效」的诊断中，只有一次是真的失效。

## Impact

- omp-worker-mcp 链路三次误判为「代码问题」，实际全是环境与配置定位问题。
- 一个可用 provider 在 UI 中长期不可见，且无任何用户可见提示。

## Timeline

1. 首次判断 OMP CLI 未安装（`which omp` 为空）。实际已装在
   `~/.bun/bin/omp`，只是不在 PATH 中。
2. `omp -p` 直接调用时停在 `readPipedInput` 达 110s。原因是沙箱把 stdin
   当管道，而非 OMP 启动慢。
3. 补 `</dev/null` 后暴露真实错误：`401 authentication_error`。
4. 判断「OMP 无凭据」（`~/.omp/agent/agent.db` 的 `auth_credentials` 为空）。
   该判断正确，但得出的结论不完整。
5. 换用新 key 后仍报 401，且报的是旧 key 的末四位——说明 OMP 读的不是
   刚改的那个文件。
6. 定位到 `PI_CODING_AGENT_DIR=/Users/1234/.tether`：宿主把 OMP 的配置根
   指向了自己的目录。指向 `~/.omp/agent` 后，同一条命令立即返回
   `OMP_CLI_OK`。

## Root cause

1. **同一进程环境的继承是隐式的。** OMP 与宿主共享 `PI_*` 环境变量命名空间，
   宿主的 `PI_CODING_AGENT_DIR` 直接改变了 OMP 的配置根。没有显式覆盖时，
   改动 OMP 自己的 `~/.omp/agent/models.yml` 完全无效。
2. **两级白名单里空数组的含义是「全不启用」而非「不限制」。**
   `mcpEnabledServers: []` 过滤掉了所有 MCP，日志只体现为 `mcp=0`，
   没有任何一条「你有 9 个 MCP 全部未启用」的提示。
3. **provider 文件的形状校验是硬性的。** `config` 缺失即跳过，只写一条
   console warning。用户无从得知。
4. **`bin/*.mjs` 缺少执行权限。** 仓库里该文件是 `-rw-r--r--`，用它自己的
   `node bin/omp-worker-mcp.mjs` 调用不会暴露问题（node 只做读取），
   但宿主按可执行文件直接 spawn 时得到 `EACCES`。

## Guardrails

- **外部 CLI 的配置根必须显式指定**，不依赖继承。MCP 条目的 `env` 里写死
  `PI_CODING_AGENT_DIR`，使 OMP 始终读自己的目录。
- **接入前逐项验证路径可执行性**，不只看存在：
  `command`、每个 `args`、每个 `env` 值指向的目录都要过一遍。
- **白名单改动后用 boot 行的 `mcp=N` 验收**。这是唯一直接的证据，
  UI 显示与进程列表都可能滞后。
- **provider 文件归一化后要回写**，避免每次启动重新解释，也让其他读者
  看到规范形状。

## Lessons

- **「凭据无效」要分两问**：key 本身是否有效，以及工具读的是哪个文件。
  本次前者为真（旧 key 确实失效），但不定位后者就无法让改动生效。
- **报错里的末四位是定位线索。** 401 消息中的 `****58C2` 与 `auth.json`
  里 key 的末四位一致，这个巧合恰恰说明是「文件选错」而非「key 选错」。
- **多个 `~/.xxx` 目录同时存在时，必须确认哪个是活跃配置根。**
  本次 `~/.omp`（OMP 的）和 `~/.tether`（宿主的）各有完整的
  `config.yml` 与 `agent.db`，仅凭目录内容无法区分。
- **静默跳过是最难排查的失败模式。** provider 文件被跳过、MCP 被白名单
  过滤，都只留下非致命的 log 行。这类路径应当至少在 UI 上留可见痕迹。

# Ubuntu 24.04 x64 构建与验收

setup / build 分工、业务构建去重与缓存失效规则见 [构建资源准备与复用](../tech_docs/build_resource_preparation.md)。

当前 Linux 构建目标限定为 **Ubuntu 24.04 x64（amd64 / x86_64-unknown-linux-gnu）**。脚本包含环境初始化、开发版与 `.deb` 安装包构建；真实 Linux 构建、桌面启动和录音验收通过后才能声明该版本可发布。Ubuntu 22.04、arm64、其它发行版与 AppImage 不在当前交付承诺中。

需要 Linux 环境，不要求独立实体机器。可使用 Ubuntu 主机、虚拟机或 GitHub Actions 的标准 `ubuntu-24.04` runner。macOS 不能直接运行 Linux 构建入口；Apple Silicon 上的 Ubuntu arm64 也不等于 x64 构建环境。

## 一组入口

| 入口 | 职责 | 输出 |
| --- | --- | --- |
| `./setup.sh` | Linux 系统依赖、项目依赖、固定 Rust 工具链与完整开发资源 | 可以继续 dev/release 构建 |
| `./build_dev_linux.sh` | 复用 Linux 资源准备，构建 debug app；有桌面会话时启动 | checkout 内的开发版可执行文件 |
| `./build_dev_linux.sh --build-only` | 相同 dev 构建，不启动 | 用于 CI 或暂不启动应用 |
| `./build_linux.sh` | 复用资源准备，构建 release `.deb` | Ubuntu 安装包 |
| `npm run tauri:dev` | setup 完成后的 Tauri/Vite 热更新开发 | 交互开发会话 |

`build_linux.sh` 是三条入口共用的 Linux 资源准备 owner：`--prepare` 只准备资源；`--install-deps` 安装系统构建依赖；`--check-system-deps` 只检查系统依赖。`build_dev_linux.sh` 只选择 debug/启动行为，不复制另一套 native/SDK/Node 打包逻辑。

## 首次准备

先安装 Node.js **24**（含 npm）和 rustup。Rust 精确版本、rustfmt/clippy 由根目录 `rust-toolchain.toml` 与既有 `ensure_rust_toolchain.sh` 管理，不依赖浮动 stable。

```bash
./setup.sh
```

Linux setup 会通过 apt 安装构建依赖，普通用户需要 sudo 权限。系统包清单由 `build_linux.sh` 的 `SYSTEM_PACKAGES` 维护，包含 GTK/WebKitGTK、托盘、OpenSSL、PipeWire、ALSA、xdo、CMake、Clang/libclang 等，不在文档和 CI 复制另一份易漂移的清单。

CMake 必须满足 native prepare owner 的 **3.28+** 要求。setup 在下载大资源和 npm 安装前检查原生工具。完成后资源包括 Node/npm、Claude SDK native binary、sharp、tsx、Sidecar/Bridge/CLI/Playwright 控制代码、Document/Media Worker、OCR/ORT/PDFium 和语音 native adapter。项目 native resource cache 按 target/fingerprint 复用。

## 开发版

```bash
./build_dev_linux.sh
# 或只构建
./build_dev_linux.sh --build-only
```

可执行文件：

```text
src-tauri/target/x86_64-unknown-linux-gnu/debug/myagents
```

开发版启用 debug 行为（包括禁止真实自动更新），使用本 checkout 的开发代码和资源；保留整个 checkout，不能把单独一个 debug 可执行文件当成可分发安装包。有桌面会话时脚本启动应用；无 `DISPLAY`/`WAYLAND_DISPLAY` 时仅打印启动路径，不把无桌面误判为编译失败。

脚本不会杀死已有 MyAgents 或其它开发会话。若已运行安装版，先正常退出，再启动开发版；应用现有 single-instance owner 负责实例准入。开发版仍使用应用正常用户数据目录，重要数据先自行备份。

## `.deb` 安装包

```bash
./build_linux.sh
# 可显式传递同一个 target；其它 target 会在资源写入前失败
./build_linux.sh x86_64-unknown-linux-gnu
```

输出：

```text
src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/*_<version>_amd64.deb
```

Linux 的 Tauri 平台配置只生成 deb，关闭 updater artifacts，因此普通构建不需要生产 updater 私钥。它仍复用主配置的资源映射，显式补充音频、OpenSSL、媒体播放、git/xdg 等系统运行依赖。原生资源 staging 的 manifest/model 最终需要所有普通用户可读，才能供 root 安装后的应用使用；native cache 仍保持私有权限。

```bash
sudo apt install ./MyAgents_<version>_amd64.deb
```

文件名以实际输出为准。通过桌面菜单启动 MyAgents，或运行 `/usr/bin/myagents`。应用随包携带 Node/npm，用户无需安装系统 Node。若已投影 `~/.myagents/bin/myagents` CLI，裸 `myagents` 可能指向 CLI；不要把 CLI 与桌面可执行文件混为一谈。

升级当前测试包采用同样的 `apt install ./新版.deb` 覆盖安装。尚未发布 Linux 更新清单，也未建立 APT 源；Rust 和 Renderer 均禁用 Linux 应用内更新检查、下载与安装，设置页提供发布页链接及手动升级说明。关闭 updater artifacts 本身不会禁用运行期更新。卸载用 `sudo apt remove myagents`，用户工作区与 `~/.myagents` 数据由用户保留/管理。

## 自动验证

`.github/workflows/linux-package.yml` 使用标准 `ubuntu-24.04` runner 验证同一组本地入口：

1. 执行 `setup.sh`。
2. 执行构建脚本契约测试与 `build_dev_linux.sh --build-only`。
3. 在临时用户数据目录、D-Bus/Xvfb 会话中检查开发版启动及 Sidecar readiness。
4. 执行 `build_linux.sh`，上传 deb（保存 7 天）。
5. 在独立 `ubuntu:24.04` 容器通过 apt 安装 deb，以非 root 用户验证，再卸载。

安装检查由 `scripts/linux-package-smoke.py` 执行：native manifest/hash、x64 ELF、动态库依赖、随包 Node/npm/SDK 启动、JS bundles 语法、sharp/tsx/浏览器控制包、ORT/PDFium/语音共享库加载、真实 Document Worker 协议和桌面进程 Sidecar readiness。运行目录不使用源码目录，不依赖系统 Node；检查用的版本锁和 smoke harness 从 checkout 读取。

工作流可手动触发，相关 Linux 构建文件 push 时也会执行。它没有发布权限、不会创建 Release、不读取生产 secrets。首次推送/执行必须有维护者授权。新增工作流的静态检查不能代替它实际运行成功。

## 发布前的真实桌面验收

以下是 mandatory，Xvfb 或单个库 load 不能替代：

- 在干净 Ubuntu 24.04 x64 桌面完成 setup → dev build → 启动；中文输入、窗口、文件选择与附件预览正常。
- 在另一套没有系统 Node 的桌面安装 deb，完成 Agent 对话/工具调用、退出和恢复。
- PDF/OCR 实际处理及语音模型安装/转录成功；验证 Native Worker 在安装路径加载。
- 麦克风录音与回放正常。Linux capture 明确使用 PipeWire host；系统声音只接受可用 default sink monitor。无 monitor 时允许明确提示后 microphone-only，不能把安装了音频库当成已验证系统声音。
- 在 Wayland/X11 的实际目标桌面检查快捷键、托盘、协议链接和媒体播放。
- 覆盖安装新版后会话/配置/工作区保留，卸载无残留运行进程。

## 当前功能边界

Linux 的托管 Codex 安装、CLIProxy/Antigravity 组件、悬浮球/桌宠、Cuse 桌面控制尚未实现与 macOS/Windows 的功能齐平。Cuse 在 Linux staging 中主动省略。这些功能的适配是独立工作；构建成功不代表它们可用。

Linux 的 Provider 列表过滤托管 Codex 与 CLIProxy/Antigravity，禁止托管 Codex 自动更新和模型查询，不创建 CLIProxy 状态轮询。桌宠的导航、页面与实验开关隐藏，旧桌宠路由转到关于页。平台限制只影响当前显示和执行，不改写或清除用户原有配置；普通 API Provider 和用户自装 CLI Runtime 保持现有行为。录音、OCR 等已有 Linux 实现保留，等待真机验证。

隐藏的内置 Provider 仍是合法配置项，不能被 Settings 的无效 ID 清理删除。保存代理范围或启用/排序时，ConfigProvider 在既有配置锁内从磁盘最新状态保留隐藏项；可见列表不承担完整持久化配置的权威。

浏览器 Chromium/Headless Shell/FFmpeg 通过既有 Rust resource owner 按需下载，不随普通安装包预装。Mino 与其它 bundled workspaces 只初始化新工作区，不覆盖用户已有副本。

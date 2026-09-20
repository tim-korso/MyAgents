# 复盘：源码构建被五个外部网络门卡住

## Executive summary

从源码构建 ONNX Runtime 与语音资源的过程中，构建连续在五处失败，每次的错误信息都指向
「构建配置错误」，实际根因全是**外部依赖获取**。真正的问题不是某个 URL 不通，而是
**四条独立防线都默认「网络可靠」**：ORT 的 CMake FetchContent、资源 prepare 的
Node fetch、其 curl 回退、以及最初的排查方向（把超时当成配置错误）。

持久教训：当一个构建步骤涉及远程获取时，「文件校验通过」才是唯一可信的完成信号；
日志里出现 `Fetch ... from <本地镜像>` 才是「没在走网络」的证据。

## Impact

- 源码构建在 `prepare:native-inference` 阶段反复失败，先后阻塞五次。
- 若不修，交付物只能退回复用已安装 app 的资源，无法证明构建可独立复现。

## Timeline

1. 首次失败：`abseil_cpp-populate ... Operation timed out`。
   初判为 CMake 配置错误，实际是 `github.com` archive 直连 25s 超时。
2. 第二次：`gh-proxy.com` 在 `cmake/external/onnx` 子模块处 `unexpected disconnect`。
3. 第三次：PDFium 3.3MB 直连 `fetch failed`，Node fetch 报 `fetch failed` 后
   脚本自身的 curl 回退成功（`redirect: 'error'` 与 GitHub 302 不兼容，
   但回退路径用 `--location`，因此能过）。
4. 第四次：`huggingface.co` 直连 HTTP 000 超时（OCR 模型）。
5. 第五次：`codeload.github.com` 的 sherpa-onnx 源码超时。

## Root cause

1. **ORT 的依赖下载不走 git 全局配置。** 本机 git 全局把 `github.com` 改写为
   `gh-proxy.com` 镜像，但 CMake `FetchContent` 直接下载 archive URL，
   完全绕过 git 配置，因而直连超时。ORT 提供了官方离线机制
   `onnxruntime_CMAKE_DEPS_MIRROR_DIR`（默认 `${REPO_ROOT}/mirror`）：
   若镜像目录下存在与 URL 去掉 `https://` 后同名的文件，就改用本地副本。
   未使用该机制是根因。
2. **两个下载实现的重定向策略不一致。** `downloadBuildResource` 默认
   `redirect: 'error'`，而 GitHub release 资产一律 302 到
   `release-assets.githubusercontent.com`。同一仓库的 curl 回退用 `--location`，
   行为不同——所以「有时能过、有时不能过」。
3. **HuggingFace 与 codeload 在本网络不可达**，而这两处依赖没有镜像回退路径。
4. **首次排错把网络超时误判为构建配置错误**，方向错误，多耗一轮。

## Guardrails

- **D6（新增 check）**：`check-goal.js` 断言资源 provenance 记录各资源的获取方式，
  避免「资源齐全但来源不明」被当成通过。见 `data/build-provenance.json`。
- **构建脚本前置检查**：`prepare:native-inference --check-prerequisites` 必须
  在真正构建前通过；本次就是靠它确认 CMake/Python 已就绪，从而把注意力正确
  转移到网络问题上。
- **镜像预填复用既有机制**：优先使用上游自带的镜像变量
  （`onnxruntime_CMAKE_DEPS_MIRROR_DIR`），而不是改源码或包一层新的下载器。
  ORT 的 41 个依赖全部经此机制预填，日志可见 `Fetch <dep> from .../mirror/...`。
- **按内容寻址预填缓存**：HuggingFace 与 codeload 的缺口，通过把字节放到
  prepare 脚本自己计算的内容寻址路径（`downloads/<sha256>-<cacheName>`）解决。
  路径必须由脚本的 `contentAddressedDownloadPath()` 计算，不能手工拼：
  cacheName 拼错（多带 target 前缀或多带类别前缀）时，表现为
  「缓存已就位但仍重复下载」，且没有任何报错提示路径不符。

## Lessons

- **构建工具的错误信息会指向错误的方向。** `CMake Error at FetchContent.cmake ...
  Build step for abseil_cpp failed` 看起来像配置问题，实际日志上游
  （被参数列表淹没的那几行）才写着 `Operation timed out`。定位这类问题时
  必须先看完整 stderr，而不是 CMake 的收尾摘要。
- **「配置正确」不等于「依赖可得」。** 本次前置条件检查全部通过，
  说明本机工具链没问题；问题自始至终只有一个：远程字节。
- **同一仓库的两条下载路径可能有不同网络语义**（`redirect: 'error'` vs
  `--location`）。排查「时好时坏」的下载必须有意识地对比这两条路径。
- **验收脚本自己也会错。** `check-goal.js` 首版含 4 处缺陷，均已修复：
  `codesign` 输出在 stderr（假阴性）、`execFileSync` 返回值语义误用、
  `cmd | head` 退出码恒为 0（假阳性）、`--verify` 成功时无输出需看退出码。
  验收脚本本身也需要被验证，不能默认它正确。

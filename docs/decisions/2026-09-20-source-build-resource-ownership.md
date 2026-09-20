# 资源来源：从源码构建，而非复用已安装 app 的产物

## Problem

`src-tauri/resources/document-processing` 与 `speech-inference` 需要在构建时准备好，
二者都依赖 ONNX Runtime 1.28.0。该版本没有满足 macOS 13 deployment target 的官方
macOS arm64 预编译产物，因此仓库的 lock 文件规定从源码构建
（`src-tauri/document-worker/resource-lock.json` 的 `onnxRuntime.sourceBuild`）。

此前本机缺 CMake 与满足版本的 Python，源码构建前置条件检查失败，于是走了捷径：
从已安装的 `/Applications/MyAgents.app` 复制这两个资源目录到 staging。
产物能跑，但引入两个问题：

1. **资源所有权链被绕过。** 正常链路是 prepare 入口 → prepared bundle → Tauri 打包。
   复制的字节让 `document-processing-cache` 保持为空，无法证明构建可独立复现。
2. **签名与 manifest 的关系失真。** manifest 记录的是**已签名字节**的 sha256
   （prepare 脚本先 `codesign` 再 `digestFile`）。复用外部 app 的字节意味着资源签名
   身份属于外部 app（`PMSG2Y8C6Z`），与本地产物的签名身份不一致，将来重签即破坏摘要。

## Decision

改为让仓库自身的 prepare 入口准备全部资源，`document-processing-cache` 从空开始，
ONNX Runtime 由 `scripts/prepare-document-processing.mjs` 按 lock 锁定的 commit
`da9b5e364c465de65c49d91e696cd6485270757f` 执行源码构建。

前置条件由 `node scripts/prepare-native-inference.mjs --check-prerequisites` 判定；
本机已具备 CMake 4.4.3、Python 3.13/3.14、Apple Clang 与 git，检查通过。

## Alternatives considered

**继续复用已安装 app 的资源。** 被否：能让产物跑起来，但无法证明构建可复现，
且资源签名身份与本地不一致，违反 manifest 对「已签名字节」的绑定语义。

**改用官方预编译 ONNX Runtime。** 被否：1.28.0 的官方 macOS arm64 archive 最低要求
macOS 14，会破坏 App 声明的 macOS 13 deployment target；x64 更是没有官方 binary。
这也是 lock 文件规定源码构建的原因。

**降级到有预编译产物的 ORT 版本。** 被否：需要同时改 lock、document-worker 的
Rust 依赖与 recipe，属于改变运行时事实，不是本目标的授权范围。

**用 `spctl rejected` 换 Developer ID 证书来解决公证。** 不可行：本机
`security find-identity -v -p codesigning` 只有两个 Apple Development 证书，
没有 Developer ID 私钥，无法签发可公证的身份。

## Consequences

**收益**：

- 资源来源可追溯到锁定 commit，构建可独立复现。
- 资源与主 bundle 使用同一签名身份，manifest 摘要语义自洽。
- 前置条件检查成为显式 gate，不再依赖「某次运行过 setup」。

**代价**：

- 首次构建需编译 ONNX Runtime，耗时与磁盘占用显著上升
  （源码 checkout、submodule 与 build 目录合计占用 GB 级）。
- 本机必须常驻 CMake 3.28+ 与 Python 3.10+；缺失时构建会明确失败而非静默降级。
- 无 Developer ID 证书，产物仍无法公证，`spctl -a` 必然 `rejected`。
  这是本机证书条件的直接后果，被记录为已知限制而非成功。

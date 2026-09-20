# 从源码重建 MyAgents.app

本文给出在**没有官方预构建资源**的机器上产出可用 `.app` 的完整步骤。
每一步都说明如何验证，避免把「命令没报错」当成「资源就绪」。

## 前置条件

| 依赖 | 最低版本 | 用途 | 验证 |
|---|---|---|---|
| Node.js | 24 | 构建脚本与 sidecar | `node --version` |
| Rust | 随 `rust-toolchain.toml` | Tauri 壳 | `cargo --version` |
| CMake | 3.28 | 编译 ONNX Runtime | `cmake --version` |
| Python | 3.10 | ONNX Runtime 构建驱动 | `python3 --version` |
| Apple Clang | — | 编译原生依赖 | `clang --version` |
| git | — | 拉取 ONNX Runtime 源码 | `git --version` |

macOS 附带 Python 3.9 不满足要求，需另装 3.10+。

### Xcode 许可导致工具退出 69 时的处理

若 Xcode 已升级但 `/Library/Preferences/com.apple.dt.Xcode.plist` 中的
`IDEXcodeVersionForAgreedToGMLicense` 仍是旧版本，所有经 `xcrun` 中介的工具
（`cc`、`swift`、`git`、`bindgen`、`otool`）会以退出码 69 失败，症状是链接器、
Swift 包构建或 `otool` 断言失败。指向 CommandLineTools 可绕过该检查：

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
```

仓库的 `src-tauri/.cargo/config.toml` 已固定该工具链，并通过
`BINDGEN_EXTRA_CLANG_ARGS` 提供 bindgen 需要的 sysroot（bindgen 不读 `SDKROOT`）。

## 步骤

### 1. 安装依赖并核对原生构建前置

```bash
npm ci
npm run prepare:native-inference -- --check-prerequisites
```

该检查会分别报告 document-processing 与 speech-inference 的前置条件。
**必须两项都 ready 才继续**；缺项时它会给出安装命令，构建脚本不会自动安装系统包。

### 2. 写入签名配置

`build_macos.sh` 从 `.env` 读取签名变量，缺失时直接退出。至少需要：

```bash
cat > .env <<'EOF'
APPLE_SIGNING_IDENTITY="Apple Development: <证书名> (<TEAMID>)"
APPLE_TEAM_ID="<TEAMID>"
EOF
```

用 `security find-identity -v -p codesigning` 查看可用身份。

选 Apple Development 而非 ad-hoc 的原因：ad-hoc 签名的 designated requirement
退化为 `cdhash`，每次重签都变，macOS TCC 会把每次重建都当成新应用重新询问权限，
已授权记录永远无法匹配。Apple Development 签出的 DR 不含 cdhash，跨重建稳定。

公证需要 Developer ID 证书；本机没有，因此 `spctl` 会拒绝，这是预期结果。

### 3. 从源码准备原生推理资源

```bash
npm run prepare:native-inference
```

这一步会按 `src-tauri/document-worker/resource-lock.json` 锁定的 commit 检出
ONNX Runtime 并执行 CMake Release 构建（`--build_shared_lib --parallel --skip_tests`），
同时准备 PDFium、OCR 模型与语音模型集。首次执行耗时最长，产物缓存在
`src-tauri/resources/document-processing-cache/`，重复执行命中缓存后直接复用。

关键不变量：prepare 脚本先对 ORT / PDFium / worker 执行 `codesign`，
**之后**才用 `digestFile()` 计算 manifest 摘要。因此：

- manifest 绑定的是已签名字节，改签这些文件必然破坏摘要；
- 不要对成品 `.app` 执行 `codesign --deep` 或递归重签。

验证资源就绪（两个 manifest 的每个文件都要匹配）：

```bash
node -e '
const fs=require("fs"),c=require("crypto"),p=require("path");
for(const r of ["document-processing","speech-inference"]){
  const d=`src-tauri/resources/${r}/v1`,m=JSON.parse(fs.readFileSync(p.join(d,"manifest.json"),"utf8"));
  let n=0,bad=0;
  const want=k=>k==="worker"?m.worker.sha256:m.files[k].sha256;
  const ck=(l,f)=>{const b=fs.readFileSync(p.join(d,f));n++;
    if(c.createHash("sha256").update(b).digest("hex")!==want(l)){bad++;console.log("MISMATCH",r,l)}};
  if(m.worker)ck("worker",m.worker.path);
  for(const[k,v]of Object.entries(m.files||{}))ck(k,v.path);
  console.log(r,`checked=${n} bad=${bad}`);}'
```

### 4. 构建

```bash
./build_macos.sh
```

该脚本依次加载 `.env`、检查依赖、校验 CSP、跑类型检查、构建前端与服务端 bundle、
签名 vendor 二进制、执行 Tauri 打包。它比直接调用 `tauri build` 多做的关键工作是：
把 `APPLE_SIGNING_IDENTITY` 传递给资源签名与主 bundle，使两者身份一致。

直接跑 `npx tauri build` 会跳过这些步骤，得到 ad-hoc 签名、资源与主 bundle 身份不一致的产物。

### 5. 验证产物

```bash
npm run goal-check
```

该命令把 `docs/goal-success-signals.md` 的条件逐条落到可执行检查，产出
`data/goal-check.json`。它独立复核资源摘要、签名、运行时健康与启动日志，
不依赖构建过程自报成功。

安装并启动：

```bash
osascript -e 'quit app "MyAgents"' 2>/dev/null; sleep 3
rm -rf /Applications/MyAgents.app
cp -R -p src-tauri/target/release/bundle/macos/MyAgents.app /Applications/
open -a /Applications/MyAgents.app
curl -s http://127.0.0.1:31415/health
```

## 已知限制

- **无法公证。** 需要 Developer ID 证书；本机只有 Apple Development。
  首次打开可能需要在 Finder 中右键「打开」。`spctl -a` 报 `rejected` 属预期。
- **单架构。** 默认只构建宿主架构；双架构需在 `build_macos.sh` 中选择。
- **自动更新不可用。** 缺少 `TAURI_SIGNING_PRIVATE_KEY`，不生成 `.sig`；
  该缺失不影响 `.app` 本体，只影响应用内更新链路。
- **Apple Development 证书有效期一年**，到期后需更换证书并重新授权系统权限。

#!/bin/bash
# Publish the MyAgents-managed Codex runtime bundle to Cloudflare R2.
#
# This is intentionally separate from publish_release.sh so a missing or
# republished runtime manifest can be fixed without rebuilding the desktop app.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
RUNTIME_LOCK_FILE="${PROJECT_DIR}/src/shared/managed-codex-runtime.json"
R2_BUCKET="myagents-releases"
DOWNLOAD_BASE_URL="https://download.myagents.io"
DEFAULT_OUT_DIR="${PROJECT_DIR}/dist/managed-codex"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PLATFORMS=""
OUT_DIR="$DEFAULT_OUT_DIR"
YES=0
NO_PURGE=0
NO_VERIFY=0
FORCE_REPUBLISH=0
RCLONE_CONFIG=""

usage() {
    cat <<EOF
Usage: ./publish_managed_codex_runtime.sh [options]

Packages and uploads Managed Codex runtime artifacts to:
  ${DOWNLOAD_BASE_URL}/runtimes/codex/sets/<runtime-set>/

Options:
  --platforms LIST           Comma-separated platforms, e.g. darwin-arm64,darwin-x64,win32-x64.
  --out DIR                  Packaging output root. Default: dist/managed-codex.
  --force-republish          Allow overwriting an existing runtime set path.
  -y, --yes                  Skip interactive confirmation.
  --no-purge                 Skip Cloudflare CDN purge.
  --no-verify                Skip post-upload HTTP verification.
  -h, --help                 Show this help.

Required .env keys:
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_ACCOUNT_ID

Recommended .env keys:
  CF_ZONE_ID
  CF_API_TOKEN

Packaging/signing also requires the variables consumed by scripts/package-managed-codex-runtime.mjs:
  TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  MANAGED_CODEX_WINDOWS_CERT_SHA256

Optional release assertions:
  MANAGED_CODEX_MACOS_TEAM_ID
  MANAGED_CODEX_MACOS_SIGNING_IDENTITY
EOF
}

read_runtime_lock_version() {
    node - "$RUNTIME_LOCK_FILE" <<'NODE'
const { readFileSync } = require('node:fs');
const [lockPath] = process.argv.slice(2);
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const version = lock.version;
if (
  typeof version !== 'string'
  || version.trim() !== version
  || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
) {
  throw new Error(`Managed Codex runtime lock requires a canonical semver version: ${lockPath}`);
}
process.stdout.write(version);
NODE
}

require_command() {
    local command_name="$1"
    local install_hint="$2"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo -e "${RED}错误: 缺少 ${command_name}${NC}"
        echo "$install_hint"
        exit 1
    fi
}

require_option_value() {
    local option_name="$1"
    local option_value="${2:-}"
    if [ -z "$option_value" ] || [[ "$option_value" == --* ]]; then
        echo -e "${RED}错误: ${option_name} 需要一个值${NC}"
        usage
        exit 1
    fi
}

validate_runtime_set_slug() {
    local value="$1"
    if [[ ! "$value" =~ ^codex-[0-9A-Za-z._-]+$ ]]; then
        echo -e "${RED}错误: runtime set 只能使用 codex-[0-9A-Za-z._-]+ 格式: ${value}${NC}"
        exit 1
    fi
}

cleanup() {
    if [ -n "$RCLONE_CONFIG" ]; then
        rm -f "$RCLONE_CONFIG" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

while [ "$#" -gt 0 ]; do
    case "$1" in
        --platforms)
            require_option_value "$1" "${2:-}"
            PLATFORMS="${2:-}"
            shift 2
            ;;
        --out)
            require_option_value "$1" "${2:-}"
            OUT_DIR="${2:-}"
            if [[ "$OUT_DIR" != /* ]]; then
                OUT_DIR="${PROJECT_DIR}/${OUT_DIR}"
            fi
            OUT_DIR="${OUT_DIR%/}"
            shift 2
            ;;
        --force-republish)
            FORCE_REPUBLISH=1
            shift
            ;;
        -y|--yes)
            YES=1
            shift
            ;;
        --no-purge)
            NO_PURGE=1
            shift
            ;;
        --no-verify)
            NO_VERIFY=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

require_command node "请先安装 Node.js。"
CODEX_VERSION="$(read_runtime_lock_version)"
RUNTIME_SET="codex-${CODEX_VERSION}"

if [ -z "$RUNTIME_SET" ] || [ -z "$CODEX_VERSION" ]; then
    echo -e "${RED}错误: 无法从 ${RUNTIME_LOCK_FILE} 读取 Managed Codex 版本${NC}"
    exit 1
fi
validate_runtime_set_slug "$RUNTIME_SET"

RUNTIME_DIR="${OUT_DIR}/sets/${RUNTIME_SET}"
R2_TARGET="r2:${R2_BUCKET}/runtimes/codex/sets/${RUNTIME_SET}/"
PUBLIC_BASE_URL="${DOWNLOAD_BASE_URL}/runtimes/codex/sets/${RUNTIME_SET}"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${GREEN}Managed Codex Runtime 发布到 Cloudflare R2${NC}       ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  ${BLUE}Runtime set:    ${RUNTIME_SET}${NC}"
echo -e "${CYAN}║${NC}  ${BLUE}Codex runtime:   ${CODEX_VERSION}${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}[1/6] 加载配置...${NC}"
if [ -f "$ENV_FILE" ]; then
    set +u
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    set -u
    echo -e "${GREEN}✓ 已加载 .env${NC}"
else
    echo -e "${RED}错误: .env 文件不存在${NC}"
    exit 1
fi

if [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ] || [ -z "${R2_ACCOUNT_ID:-}" ]; then
    echo -e "${RED}错误: R2 配置不完整${NC}"
    echo "请在 .env 中配置 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID"
    exit 1
fi
echo -e "${GREEN}✓ R2 配置已验证${NC}"
echo ""

echo -e "${BLUE}[2/6] 检查依赖...${NC}"
require_command node "请先安装 Node.js。"
require_command rclone "macOS 可执行: brew install rclone"
require_command curl "请先安装 curl。"
echo -e "${GREEN}✓ 依赖已就绪${NC}"
echo ""

echo -e "${BLUE}[3/6] 打包 Managed Codex runtime...${NC}"
PACKAGE_ARGS=(
    "${PROJECT_DIR}/scripts/package-managed-codex-runtime.mjs"
    --out "$OUT_DIR"
)
if [ -n "$PLATFORMS" ]; then
    PACKAGE_ARGS+=(--platforms "$PLATFORMS")
fi
node "${PACKAGE_ARGS[@]}"

if [ ! -d "$RUNTIME_DIR" ]; then
    echo -e "${RED}错误: runtime 目录不存在: ${RUNTIME_DIR}${NC}"
    exit 1
fi

MANIFEST_COUNT=$(find "$RUNTIME_DIR" -path "*/manifest-v1.json" -type f | wc -l | tr -d ' ')
MANIFEST_SIG_COUNT=$(find "$RUNTIME_DIR" -path "*/manifest-v1.json.sig" -type f | wc -l | tr -d ' ')
ARTIFACT_COUNT=$(find "$RUNTIME_DIR" -path "*/artifacts/*.zip" -type f | wc -l | tr -d ' ')
if [ "$MANIFEST_COUNT" = "0" ] || [ "$MANIFEST_SIG_COUNT" = "0" ] || [ "$ARTIFACT_COUNT" = "0" ]; then
    echo -e "${RED}错误: runtime 物料不完整${NC}"
    echo "  manifests:       ${MANIFEST_COUNT}"
    echo "  manifest sigs:   ${MANIFEST_SIG_COUNT}"
    echo "  artifact zips:   ${ARTIFACT_COUNT}"
    exit 1
fi

node - "$RUNTIME_DIR" "$RUNTIME_SET" "$CODEX_VERSION" "$PUBLIC_BASE_URL" <<'NODE'
const { existsSync, readFileSync } = require('node:fs');
const { basename, dirname, join, relative } = require('node:path');
const [runtimeDir, runtimeSet, codexVersion, publicBaseUrl] = process.argv.slice(2);
const { execFileSync } = require('node:child_process');
const manifestList = execFileSync('find', [runtimeDir, '-path', '*/manifest-v1.json', '-type', 'f'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .sort();
if (manifestList.length === 0) throw new Error('No manifest-v1.json files found');
for (const manifestPath of manifestList) {
  const platform = basename(dirname(manifestPath));
  const rel = relative(runtimeDir, manifestPath).split('\\').join('/');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.runtimeSet !== runtimeSet) throw new Error(`${rel}: runtimeSet mismatch`);
  if (manifest.codexVersion !== codexVersion) throw new Error(`${rel}: codexVersion mismatch`);
  if (manifest.platform && manifest.platform !== platform) throw new Error(`${rel}: platform mismatch`);
  const sigPath = `${manifestPath}.sig`;
  if (!existsSync(sigPath) || readFileSync(sigPath, 'utf8').trim() === '') {
    throw new Error(`${rel}: missing manifest signature`);
  }
  const artifact = manifest.artifacts?.[platform];
  if (!artifact) throw new Error(`${rel}: missing artifact for ${platform}`);
  const expectedUrlPrefix = `${publicBaseUrl}/${platform}/artifacts/`;
  if (typeof artifact.url !== 'string' || !artifact.url.startsWith(expectedUrlPrefix)) {
    throw new Error(`${rel}: artifact URL must start with ${expectedUrlPrefix}`);
  }
  const artifactName = basename(new URL(artifact.url).pathname);
  const artifactPath = join(dirname(manifestPath), 'artifacts', artifactName);
  if (!existsSync(artifactPath)) throw new Error(`${rel}: missing local artifact ${artifactName}`);
  if (!existsSync(`${artifactPath}.sha256`)) throw new Error(`${rel}: missing local artifact sha256`);
  if (typeof artifact.signature !== 'string' || artifact.signature.trim() === '') {
    throw new Error(`${rel}: missing artifact signature`);
  }
}
NODE

if [ "$FORCE_REPUBLISH" -ne 1 ]; then
    EXISTING_MANIFEST_URLS=()
    while IFS= read -r manifest; do
        rel="${manifest#${RUNTIME_DIR}/}"
        url="${PUBLIC_BASE_URL}/${rel}"
        if ! HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -I "$url"); then
            echo -e "${RED}错误: 无法确认远端 manifest 是否存在: ${url}${NC}"
            exit 1
        fi
        case "$HTTP_CODE" in
            200)
                EXISTING_MANIFEST_URLS+=("$url")
                ;;
            404)
                ;;
            *)
                echo -e "${RED}错误: 无法确认远端 manifest 是否存在: ${url} (HTTP ${HTTP_CODE})${NC}"
                exit 1
                ;;
        esac
    done < <(find "$RUNTIME_DIR" -path "*/manifest-v1.json" -type f | sort)

    if [ "${#EXISTING_MANIFEST_URLS[@]}" -gt 0 ]; then
        echo -e "${RED}错误: 远端 runtime set 已存在，默认不允许覆盖${NC}"
        for url in "${EXISTING_MANIFEST_URLS[@]}"; do
            echo "  $url"
        done
        echo ""
        echo "如确实需要重发同一目录，请显式添加 --force-republish。"
        exit 1
    fi
fi

echo ""
echo -e "  ${CYAN}即将上传:${NC}"
while IFS= read -r file; do
    rel="${file#${RUNTIME_DIR}/}"
    size=$(du -h "$file" | cut -f1)
    echo -e "    • ${rel} (${size})"
done < <(find "$RUNTIME_DIR" -type f | sort)
echo ""
echo -e "  ${CYAN}目标位置:${NC}"
echo -e "    ${PUBLIC_BASE_URL}/"
echo ""

if [ "$YES" -ne 1 ]; then
    read -p "确认上传? (Y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${RED}发布已取消${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}[4/6] 上传到 R2...${NC}"
RCLONE_CONFIG=$(mktemp)
chmod 600 "$RCLONE_CONFIG"
cat > "$RCLONE_CONFIG" <<EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
EOF

RCLONE_COPY_ARGS=(--config="$RCLONE_CONFIG" copy "${RUNTIME_DIR}/" "$R2_TARGET" --s3-no-check-bucket --progress)
if [ "$FORCE_REPUBLISH" -ne 1 ]; then
    RCLONE_COPY_ARGS+=(--immutable)
fi
rclone "${RCLONE_COPY_ARGS[@]}"
echo -e "${GREEN}✓ Managed Codex runtime 已上传${NC}"
echo ""

if [ "$NO_PURGE" -eq 0 ]; then
    echo -e "${BLUE}[5/6] 清除 Cloudflare CDN 缓存...${NC}"
    if [ -n "${CF_ZONE_ID:-}" ] && [ -n "${CF_API_TOKEN:-}" ]; then
        PURGE_JSON='{"files":['
        FIRST=1
        while IFS= read -r file; do
            rel="${file#${RUNTIME_DIR}/}"
            url="${PUBLIC_BASE_URL}/${rel}"
            if [ "$FIRST" -eq 1 ]; then
                FIRST=0
            else
                PURGE_JSON+=','
            fi
            PURGE_JSON+="\"$url\""
        done < <(find "$RUNTIME_DIR" -type f | sort)
        PURGE_JSON+=']}'

        PURGE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$PURGE_JSON")
        if echo "$PURGE_RESPONSE" | grep -q '"success":true'; then
            echo -e "${GREEN}✓ CDN 缓存已清除${NC}"
        else
            echo -e "${YELLOW}⚠️ CDN 缓存清除可能失败${NC}"
            echo -e "${YELLOW}响应: $(echo "$PURGE_RESPONSE" | head -c 200)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️ 未配置 CF_ZONE_ID 或 CF_API_TOKEN，跳过 CDN 缓存清除${NC}"
    fi
else
    echo -e "${BLUE}[5/6] 跳过 CDN 缓存清除${NC}"
fi
echo ""

if [ "$NO_VERIFY" -eq 0 ]; then
    echo -e "${BLUE}[6/6] HTTP 验证...${NC}"
    VERIFY_FAILED=0
    while IFS= read -r file; do
        rel="${file#${RUNTIME_DIR}/}"
        url="${PUBLIC_BASE_URL}/${rel}"
        printf "    检查 %s... " "$rel"
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -I "$url" 2>/dev/null || echo "000")
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗ (HTTP ${HTTP_CODE})${NC}"
            VERIFY_FAILED=1
        fi
    done < <(find "$RUNTIME_DIR" -type f | sort)

    if [ "$VERIFY_FAILED" -ne 0 ]; then
        echo -e "${RED}Managed Codex runtime 上传后验证失败${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ 所有 runtime 文件验证通过${NC}"
else
    echo -e "${BLUE}[6/6] 跳过 HTTP 验证${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Managed Codex runtime 发布完成${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Manifest:${NC}"
while IFS= read -r manifest; do
    rel="${manifest#${RUNTIME_DIR}/}"
    echo -e "    ${PUBLIC_BASE_URL}/${rel}"
done < <(find "$RUNTIME_DIR" -path "*/manifest-v1.json" -type f | sort)
echo ""

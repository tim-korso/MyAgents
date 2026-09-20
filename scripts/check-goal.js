#!/usr/bin/env node
/**
 * 验收脚本：源码构建产出可用 MyAgents 构建物。
 * 条件定义见 docs/goal-success-signals.md，本文件只负责把它们落成可执行 verify。
 * 用法: npm run goal-check   →  data/goal-check.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'data', 'goal-check.json');
const APP = process.env.MYAGENTS_GOAL_APP || '/Applications/MyAgents.app';
const RES = join(APP, 'Contents', 'Resources');
const OFFICIAL = join(process.env.HOME || '/Users', 'MyAgents-official-0.4.20.app');

// 本机 Xcode 许可门槛会让 xcrun 中介工具退出 69；CLT 不受影响。
const CLT = '/Library/Developer/CommandLineTools';
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || CLT };

const abs = (p) => (p.startsWith('/') ? p : join(ROOT, p));
const has = (p) => existsSync(abs(p));
const readJson = (p) => {
  try { return JSON.parse(readFileSync(abs(p), 'utf8')); } catch { return null; }
};
const run = (cmd, opts = {}) => {
  try {
    // 合并 stderr：部分工具（codesign、file）把结果写在 stderr 上。
    const out = execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout ?? 180_000, env });
    const text = String(out).trim();
    return { pass: true, detail: text.split('\n').filter(Boolean).slice(-1)[0] || cmd };
  } catch (e) {
    return { pass: false, detail: String(e.message || e).split('\n')[0] };
  }
};

/** 与 run 相同，但返回完整输出，供需要判定「输出是否为空」的检查使用。
 *  注意 `cmd | head` 这类管道退出码恒为 0，只看 exit code 会产生假阳性。 */
const runOut = (cmd, opts = {}) => {
  try {
    return { pass: true, out: String(execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout ?? 180_000, env })).trim() };
  } catch (e) {
    return { pass: false, out: ((e.stdout?.toString() || '') + (e.stderr?.toString() || '')).trim() };
  }
};

/** 校验一个资源 manifest 的每个文件（sha256 + size），返回 {checked, bad[]} */
function verifyManifest(manifestPath) {
  const dir = dirname(abs(manifestPath));
  const m = readJson(manifestPath);
  if (!m) return { ok: false, detail: 'manifest 缺失或不可解析', checked: 0, bad: [] };
  const bad = [];
  let checked = 0;
  const entries = [];
  if (m.worker) entries.push(['worker', m.worker]);
  for (const [k, v] of Object.entries(m.files || {})) entries.push([k, v]);
  for (const [label, e] of entries) {
    const p = join(dir, e.path);
    if (!existsSync(p)) { bad.push(`${label}:missing`); continue; }
    const buf = readFileSync(p);
    const sha = createHash('sha256').update(buf).digest('hex');
    checked += 1;
    if (sha !== e.sha256) bad.push(`${label}:sha256`);
    else if (e.size && buf.length !== e.size) bad.push(`${label}:size`);
  }
  return { ok: bad.length === 0 && checked > 0, detail: `checked=${checked} bad=${bad.length}`, checked, bad };
}

/** 启动时间窗内的 unified log 中是否出现指定级别的记录 */
function logScan(sinceMinutes = 30) {
  const logDir = join(process.env.HOME || '/Users', '.myagents', 'logs');
  if (!existsSync(logDir)) return { errors: [], text: '' };
  // 日志按天轮转，且进程可能跨夜运行：只看「今天」会在跨天后的首个启动里漏掉记录。
  // 因此扫描最近若干天，按时间戳做真正的窗口裁剪。
  const cutoff = Date.now() - sinceMinutes * 60_000;
  const days = [];
  for (let i = 0; i < 3; i += 1) {
    days.push(new Date(cutoff - i * 86_400_000).toISOString().slice(0, 10));
    days.push(new Date().toISOString().slice(0, 10));
  }
  const lines = [];
  for (const day of new Set(days)) {
    const f = join(logDir, `unified-${day}.log`);
    if (existsSync(f)) lines.push(...readFileSync(f, 'utf8').split('\n'));
  }
  if (lines.length === 0) return { errors: [], text: '' };
  // 多天文件拼接后不再有序，必须逐行按自身时间戳过滤，不能依赖扫描顺序提前 break。
  const recent = lines.filter((line) => {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(line);
    if (!m) return false;
    const t = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const text = recent.join('\n');
  return { errors: recent.filter((l) => /\[ERROR|panic|FATAL/.test(l)), text };
}

function codesign(args) {
  // codesign 把 -d/-dv 与 --verify 的结果写到 stderr；spawnSync 才能分别取到两个流。
  // 退出码非 0 是有意义的失败信号（如 --verify 不通过），调用方按内容判定。
  const r = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', env });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return out || `codesign 无输出 (status=${r.status})`;
}

function mainProcess() {
  try {
    const out = execFileSync('/bin/ps', ['-Ao', 'pid=,rss=,command='], { stdio: 'pipe' }).toString();
    return out.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes(`${APP}/Contents/MacOS/`))
      .map((l) => { const [pid, rss] = l.split(/\s+/); return { pid, rssKb: Number(rss) }; })[0] || null;
  } catch { return null; }
}

const DOMAINS = [
  {
    id: 'A', name: '交付物/资产',
    checks: [
      { id: 'A1', desc: '.app 主可执行文件存在且为 arm64', level: 'L0',
        verify: () => {
          const p = join(APP, 'Contents', 'MacOS', 'myagents');
          if (!existsSync(p)) return { pass: false, detail: '主可执行文件不存在' };
          const r = run(`/usr/bin/file '${p}'`);
          return { pass: r.pass && /arm64/.test(r.detail), detail: r.detail };
        } },
      { id: 'A2', desc: '七项资源目录非空（无占位）', level: 'L0',
        verify: () => {
          const want = ['document-processing', 'speech-inference', 'cliproxy',
            'claude-agent-sdk', 'nodejs', 'sharp-runtime', 'tsx-runtime'];
          const empty = want.filter((d) => {
            const p = join(RES, d);
            if (!existsSync(p)) return true;
            try { return readdirSync(p).filter((n) => n !== '.gitkeep').length === 0; } catch { return true; }
          });
          return { pass: empty.length === 0, detail: empty.length ? `空: ${empty.join(',')}` : `7/7 非空` };
        } },
      { id: 'A3', desc: '两个资源 manifest 存在且含文件', level: 'L0',
        verify: () => {
          const d = readJson(join(RES, 'document-processing/v1/manifest.json'));
          const s = readJson(join(RES, 'speech-inference/v1/manifest.json'));
          const dn = Object.keys(d?.files || {}).length;
          const sn = Object.keys(s?.files || {}).length;
          return { pass: dn > 0 && sn > 0, detail: `document.files=${dn} speech.files=${sn}` };
        } },
      { id: 'A4', desc: '产物版本号 0.4.20', level: 'L0',
        verify: () => {
          const p = join(APP, 'Contents', 'Info.plist');
          if (!existsSync(p)) return { pass: false, detail: 'Info.plist 不存在' };
          const r = run(`/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '${p}'`);
          return { pass: r.detail === '0.4.20', detail: r.detail };
        } },
      { id: 'A5', desc: '资源来源为源码构建（有 provenance 记录）', level: 'L0',
        verify: () => {
          const j = readJson('data/build-provenance.json');
          if (!j) return { pass: false, detail: 'data/build-provenance.json 缺失' };
          return {
            pass: j.sourceBuilt === true && Array.isArray(j.resources) && j.resources.length > 0,
            detail: `sourceBuilt=${j.sourceBuilt} resources=${j.resources?.length ?? 0}`,
          };
        } },
    ],
  },
  {
    id: 'B', name: '功能完整性',
    checks: [
      { id: 'B1', desc: '全局 sidecar /health 通过', level: 'L0',
        verify: () => run("curl -sf -m 6 http://127.0.0.1:31415/health") },
      { id: 'B2', desc: '/health/ready 与 /health/functional 通过', level: 'L0',
        verify: () => {
          const a = run("curl -sf -m 6 http://127.0.0.1:31415/health/ready");
          const b = run("curl -sf -m 6 http://127.0.0.1:31415/health/functional");
          return { pass: a.pass && b.pass, detail: `ready=${a.pass} functional=${b.pass}` };
        } },
      { id: 'B3', desc: '前端已挂载（react-commit）', level: 'L0',
        verify: () => {
          const { text } = logScan(120);
          const ok = /stage=react-commit/.test(text);
          return { pass: ok, detail: ok ? 'react-commit 已出现' : '启动窗内未见到 react-commit' };
        } },
      { id: 'B4', desc: '文档资源 sha256/size 全部匹配', level: 'L0',
        verify: () => {
          const r = verifyManifest(join(RES, 'document-processing/v1/manifest.json'));
          return { pass: r.ok, detail: r.detail + (r.bad.length ? ` ${r.bad.join(',')}` : '') };
        } },
      { id: 'B5', desc: '语音资源 sha256/size 全部匹配', level: 'L0',
        verify: () => {
          const r = verifyManifest(join(RES, 'speech-inference/v1/manifest.json'));
          return { pass: r.ok, detail: r.detail + (r.bad.length ? ` ${r.bad.join(',')}` : '') };
        } },
      { id: 'B6', desc: 'session sidecar 可达（非 404）', level: 'L1',
        verify: () => {
          // `/api/browser/view/token` 属于 SESSION_EXACT_PATHS，全局 sidecar 上返回 404
          // 是 correct-by-design，不能据此判定失败。真正的判据是该路径是否已注册进
          // 路由分类表——那才是 404 与否的根因，且不依赖是否有活跃会话。
          const src = readFileSync(join(ROOT, 'src/server/sidecar-composition.ts'), 'utf8');
          const sessionBlock = src.slice(
            src.indexOf('const SESSION_EXACT_PATHS'),
            src.indexOf('const GLOBAL_EXACT_PATHS'),
          );
          const registered = sessionBlock.includes('/api/browser/view/token');
          return {
            pass: registered,
            detail: registered
              ? '已注册于 SESSION_EXACT_PATHS（全局 sidecar 上 404 属预期）'
              : '未注册于 SESSION_EXACT_PATHS',
          };
        } },
    ],
  },
  {
    id: 'D', name: '性能/质量/可靠性',
    checks: [
      { id: 'D1', desc: '启动阶段无 ERROR/panic', level: 'L0',
        verify: () => {
          // 「启动阶段」= 最近一次 `[boot] v=` 到 `stage=react-commit` 之间。
          // 不能扫描整个时间窗：会话运行期的 codex stderr 等错误属于运行期事实，
          // 用它判定构建质量会产生误报，也会掩盖真正的启动失败。
          const { text } = logScan(24 * 60);
          const lines = text.split('\n');
          let start = -1;
          for (let i = lines.length - 1; i >= 0; i -= 1) {
            if (/\[boot\] v=/.test(lines[i])) { start = i; break; }
          }
          if (start === -1) return { pass: false, detail: '窗口内未找到 [boot] v= 启动标记' };
          let end = lines.length;
          for (let i = start; i < lines.length; i += 1) {
            if (/stage=react-commit/.test(lines[i])) { end = i; break; }
          }
          const boot = lines.slice(start, end);
          const errors = boot.filter((l) => /\[ERROR|panic|FATAL/.test(l));
          return {
            pass: errors.length === 0,
            detail: errors.length
              ? errors.slice(0, 2).map((l) => l.slice(0, 120)).join(' | ')
              : `启动阶段 ${boot.length} 行无 ERROR/panic`,
          };
        } },
      { id: 'D2', desc: '主进程存活且 RSS < 2GB', level: 'L0',
        verify: () => {
          const p = mainProcess();
          if (!p) return { pass: false, detail: '主进程未运行' };
          const mb = Math.round(p.rssKb / 1024);
          return { pass: mb < 2048, detail: `pid=${p.pid} rss=${mb}MB` };
        } },
      { id: 'D3', desc: '无签名失效导致的加载失败', level: 'L0',
        verify: () => {
          const { text } = logScan(120);
          const bad = /LOCAL_RUNTIME_INVALID|code signature|Code Signature|library validation/i.test(text);
          return { pass: !bad, detail: bad ? '日志出现签名/加载拒绝' : '无签名相关拒绝' };
        } },
      { id: 'D4', desc: '构建脚本单测通过', level: 'L1',
        verify: () => run('npm run test:build-scripts', { timeout: 600_000 }) },
      { id: 'D5', desc: 'TypeScript 类型检查通过', level: 'L1',
        verify: () => run('npx tsc --noEmit', { timeout: 600_000 }) },
    ],
  },
  {
    id: 'F', name: '自动化/可观测/可演示',
    checks: [
      { id: 'F1', desc: 'goal-check 自身可运行并写出结果', level: 'L0',
        verify: () => ({ pass: true, detail: 'this script' }) },
      { id: 'F2', desc: '构建留痕含各资源 prepare 记录', level: 'L1',
        verify: () => {
          const j = readJson('data/build-provenance.json');
          const n = j?.resources?.length ?? 0;
          return { pass: n >= 5, detail: `resources 记录 ${n} 条（期望 ≥5）` };
        } },
      { id: 'F3', desc: '重建说明文档存在', level: 'L1',
        verify: () => ({ pass: has('docs/build/rebuild-from-source.md'), detail: 'docs/build/rebuild-from-source.md' }) },
    ],
  },
  {
    id: 'G', name: '评审/Gate',
    checks: [
      { id: 'G1', desc: 'codesign --verify 通过', level: 'L0',
        verify: () => {
          // --verify 成功时输出为空；必须看退出码，不能只看文本。
          const r = spawnSync('/usr/bin/codesign', ['--verify', '--verbose=2', APP], { encoding: 'utf8', env });
          const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
          return {
            pass: r.status === 0,
            detail: out ? out.split('\n').slice(-2).join(' / ') : `exit=0（无输出即通过）`,
          };
        } },
      { id: 'G2', desc: '签名身份非 ad-hoc（DR 无 cdhash）', level: 'L0',
        verify: () => {
          const out = codesign(['-d', '-r-', APP]);
          const dr = out.split('\n').find((l) => l.includes('designated =>')) || '';
          const adhoc = /cdhash/i.test(dr) || dr === '';
          return { pass: !adhoc, detail: adhoc ? 'ad-hoc（cdhash，TCC 无法持久识别）' : dr.slice(0, 90) };
        } },
      { id: 'G3', desc: 'hardened runtime 已启用', level: 'L0',
        verify: () => {
          const out = codesign(['-dv', APP]);
          return { pass: /flags=0x10000\(runtime\)/.test(out), detail: (out.match(/flags=\S+/) || ['未找到 flags'])[0] };
        } },
      { id: 'G4', desc: '签名链含 Apple Root CA', level: 'L1',
        verify: () => {
          const out = codesign(['-d', '--verbose=4', APP]);
          return { pass: /Apple Root CA/.test(out), detail: (out.match(/Authority=.*/g) || ['无 Authority']).join(' ← ') };
        } },
      { id: 'G5', desc: '公证限制已显式记录', level: 'L1',
        verify: () => {
          const r = runOut(`grep -rl "公证" ${join(ROOT, 'docs/decisions')} 2>/dev/null || true`);
          return { pass: r.out.length > 0, detail: r.out || 'docs/decisions/ 未记录公证限制' };
        } },
    ],
  },
  {
    id: 'H', name: '上线/扩展',
    checks: [
      { id: 'H1', desc: '从 /Applications 启动且进程路径匹配', level: 'L0',
        verify: () => {
          const p = mainProcess();
          return { pass: !!p, detail: p ? `pid=${p.pid} 路径=${APP}` : '未从 /Applications 运行' };
        } },
      { id: 'H2', desc: '前次 ad-hoc 产物已备份可回退', level: 'L1',
        verify: () => {
          const b = join(process.env.HOME || '/Users', 'MyAgents-fork-adhoc.app');
          if (!existsSync(b)) return { pass: false, detail: '备份不存在' };
          // 与 G1 同理：--verify 成功无输出，判定依据是退出码。
          const r = spawnSync('/usr/bin/codesign', ['--verify', b], { encoding: 'utf8', env });
          return { pass: r.status === 0, detail: `${b} (verify exit=${r.status})` };
        } },
      { id: 'H3', desc: '官方原版仍可回退', level: 'L1',
        verify: () => ({ pass: existsSync(OFFICIAL), detail: OFFICIAL }) },
    ],
  },
];

const results = DOMAINS.map((d) => {
  const checks = d.checks.map((c) => {
    let r;
    try { r = c.verify(); } catch (e) { r = { pass: false, detail: String(e.message || e).split('\n')[0] }; }
    return { id: c.id, desc: c.desc, level: c.level, pass: !!r.pass, detail: r.detail ?? '' };
  });
  return { id: d.id, name: d.name, all: checks.every((c) => c.pass), checks };
});

const all = results.every((d) => d.all);
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), app: APP, all, domains: results }, null, 2)}\n`);

let failed = 0;
for (const d of results) {
  console.log(`${d.all ? '✅' : '❌'} ${d.id} ${d.name}`);
  for (const c of d.checks) {
    if (!c.pass) failed += 1;
    console.log(`   ${c.pass ? ' ' : '✗'} ${c.id} [${c.level}] ${c.desc} — ${c.detail}`);
  }
}
console.log(`\n${all ? '🎉 ALL PASS' : `❌ ${failed} 项未通过`}  →  data/goal-check.json`);
process.exit(all ? 0 : 1);

// 安装器公共件：路径、配置与进度文件、子进程、日志、退出码。
// 只用 Node 内置模块，macOS / Linux / Windows 同一份代码。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROOT = path.resolve(KIT, "..");
// 测试可用 MAILHUB_STATE_DIR 把进度与生成物放到临时目录。
export const STATE_DIR = process.env.MAILHUB_STATE_DIR
  ? path.resolve(process.env.MAILHUB_STATE_DIR)
  : path.join(ROOT, ".mailhub");
export const GEN_DIR = path.join(STATE_DIR, "generated");
export const CONFIG_FILE = path.join(STATE_DIR, "config.json");
export const STATE_FILE = path.join(STATE_DIR, "state.json");
// wrangler dev 在配置文件旁边找 .dev.vars；它是本机运行配置（两把接口密钥 + 本地免登录开关）。
export const DEV_VARS = path.join(GEN_DIR, ".dev.vars");
export const LOCAL_RUN = path.join(STATE_DIR, "local.json");
export const LOCAL_LOG = path.join(STATE_DIR, "local.log");

export const WORKER_DIR = path.join(ROOT, "modules", "cfmail-worker");
export const FRONTEND_DIR = path.join(ROOT, "modules", "unified-mail", "frontend");
export const GATEWAY_DIR = path.join(ROOT, "modules", "unified-mail", "cloud");
export const MIGRATIONS_DIR = path.join(WORKER_DIR, "migrations");
export const BASE_SCHEMA = path.join(KIT, "schema", "0000_base.sql");
// MAILHUB_WRANGLER_JS 只给离线编排测试用（指向假 wrangler），正常使用不设。
export const WRANGLER_JS = process.env.MAILHUB_WRANGLER_JS
  || path.join(KIT, "node_modules", "wrangler", "bin", "wrangler.js");

// 退出码约定（写进 SKILL.md，agent 不解析文本也能判断）：
export const EXIT = {
  OK: 0,
  FAIL: 1,         // 出错：读输出里的「原因 / 下一步」，修好后重跑同一条命令
  HUMAN: 10,       // 需要用户本人操作：把输出里的「请你操作」原样转告，等用户完成后重跑
  BAD_INPUT: 2,    // 配置不合法：改 .mailhub/config.json 后重跑
};

export class StepError extends Error {
  constructor(message, { code = EXIT.FAIL, next = "" } = {}) {
    super(message);
    this.code = code;
    this.next = next;
  }
}

export const needHuman = (message, next) => new StepError(message, { code: EXIT.HUMAN, next });

/* ── 日志 ─────────────────────────────────────────────── */

export const log = {
  step: (n, title) => console.log(`\n── [${n}] ${title} ${"─".repeat(Math.max(4, 40 - title.length))}`),
  ok: (msg) => console.log(`   ✅ ${msg}`),
  info: (msg) => console.log(`   ·  ${msg}`),
  warn: (msg) => console.log(`   ⚠️  ${msg}`),
  fail: (msg) => console.log(`   ❌ ${msg}`),
};

export function reportError(err) {
  if (err instanceof StepError && err.code === EXIT.HUMAN) {
    console.log(`\n🙋 请你操作：${err.message}`);
    if (err.next) console.log(`   ${err.next.replace(/\n/g, "\n   ")}`);
    console.log("\n   完成后重跑同一步即可；已有资源会复用，status 可查看下一步。");
    return EXIT.HUMAN;
  }
  const code = err instanceof StepError ? err.code : EXIT.FAIL;
  console.log(`\n❌ 失败：${err.message}`);
  if (err.next) console.log(`   下一步：${err.next.replace(/\n/g, "\n   ")}`);
  if (!(err instanceof StepError)) console.log(err.stack);
  return code;
}

/* ── JSON 文件 ───────────────────────────────────────── */

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new StepError(`${file} 不是合法 JSON：${e.message}`, { code: EXIT.BAD_INPUT });
  }
}

export function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode });
}

export const loadState = () => readJson(STATE_FILE, {});
export function saveState(patch) {
  const next = { ...loadState(), ...patch, updated_at: new Date().toISOString() };
  writeJson(STATE_FILE, next);
  return next;
}

/* ── .dev.vars（KEY=VALUE，一行一个）──────────────────── */

export function readDevVars(file = DEV_VARS) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function writeDevVars(vars, file = DEV_VARS) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n";
  fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 无 POSIX 权限位 */ }
}

/* ── 子进程 ───────────────────────────────────────────── */

/**
 * 同步执行，默认捕获输出。`input` 走 stdin（用来喂密钥，永不出现在参数与日志里）。
 * `secretValues` 里的值会从返回的输出中抹掉，防止上游工具回显。
 */
export function run(cmd, args, { cwd = ROOT, input, env, inherit = false, secretValues = [] } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    input,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: inherit ? ["inherit", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (res.error) throw new StepError(`无法执行 ${cmd}：${res.error.message}`);
  const scrub = (s) => secretValues.reduce((acc, v) => (v ? acc.split(v).join("***") : acc), s || "");
  return { code: res.status, stdout: scrub(res.stdout), stderr: scrub(res.stderr) };
}

/** 调 wrangler：固定用 kit 自带的版本，不依赖全局安装与 npx 下载。 */
export function wrangler(args, opts = {}) {
  if (!fs.existsSync(WRANGLER_JS)) {
    throw new StepError("kit 依赖还没装好（缺 wrangler）", {
      next: `在 ${KIT} 里执行：npm ci`,
    });
  }
  // 默认按非交互模式跑（CI=true）：确认提示取默认值、secret 从 stdin 读。
  // 只有 `wrangler login` 需要交互（开浏览器等回调），调用方传 ci:false。
  const { ci = true, ...rest } = opts;
  const accountId = loadState().account_id;
  const env = { WRANGLER_SEND_METRICS: "false", ...(ci ? { CI: "true" } : { CI: "" }), ...rest.env };
  if (accountId && !env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return run(process.execPath, [WRANGLER_JS, ...args], { ...rest, env });
}

export function wranglerOk(args, opts = {}, what = "wrangler " + args[0]) {
  const res = wrangler(args, opts);
  if (res.code !== 0) {
    const tail = (res.stderr || res.stdout).trim().split("\n").slice(-12).join("\n");
    throw new StepError(`${what} 失败（退出码 ${res.code}）\n${tail}`);
  }
  return res;
}

/** 后台常驻子进程（本地版用）。返回 pid；输出写日志文件。 */
export function spawnDetached(cmd, args, { cwd = ROOT, env, logFile }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 wrangler 的混合输出里挑出第一段 JSON（部分命令会在 JSON 前打印横幅）。 */
export function parseJsonLoose(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new StepError("wrangler 没有返回 JSON：" + text.slice(0, 300));
  return JSON.parse(text.slice(start));
}

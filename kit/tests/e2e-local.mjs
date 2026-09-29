#!/usr/bin/env node
// 离线全链路自测（维护者用，不需要 Cloudflare 账号、不连任何线上资源）：
//   本地 D1 建表 + 升级 → 本地收信 Worker 收一封模拟邮件 → 本地数据接口查到它
//   → 本地版网关（免登录）经代理读到同一封信。
// 用 wrangler 自带的本地模拟器（miniflare）跑的是**真实的 Worker 代码与真实 SQL**。
//
//   node kit/tests/e2e-local.mjs        退出码 0 = 全部通过
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const KIT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ROOT = path.resolve(KIT, "..");
const WRANGLER = path.join(KIT, "node_modules", "wrangler", "bin", "wrangler.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-e2e-"));
const STATE = path.join(TMP, "state");
const PERSIST = path.join(TMP, "d1");
const DOMAIN = "demo-mail.test";
const ADMIN = "a".repeat(64);
const SITE = "b".repeat(64);
const API_PORT = 18801;
const INBOX_PORT = 18812;
const env = { ...process.env, MAILHUB_STATE_DIR: STATE, WRANGLER_SEND_METRICS: "false", CI: "true" };

const children = [];
let failed = 0;
const check = (ok, title, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${title}${detail ? "　" + detail : ""}`);
  if (!ok) failed += 1;
};

function node(args, opts = {}) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: "utf8", ...opts });
  if (res.status !== 0) {
    throw new Error(`命令失败：${args.join(" ")}\n${(res.stderr || res.stdout).slice(-1500)}`);
  }
  return res.stdout;
}

function background(args, name) {
  const log = fs.openSync(path.join(TMP, `${name}.log`), "a");
  const child = spawn(process.execPath, args, { cwd: path.join(STATE, "generated"), env, detached: true, stdio: ["ignore", log, log] });
  children.push(child);
  return child;
}

async function waitFor(url, ok, seconds = 60) {
  for (let i = 0; i < seconds; i += 1) {
    try {
      const res = await fetch(url);
      if (await ok(res)) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function cleanup() {
  for (const c of children) {
    try { process.kill(-c.pid, "SIGTERM"); } catch { /* 已退出 */ }
  }
  spawnSync(process.execPath, [path.join(KIT, "scripts", "local.mjs"), "stop"], { cwd: ROOT, env, stdio: "ignore" });
}

try {
  // 1) 生成配置（与真实安装同一套代码路径）
  node([path.join(KIT, "scripts", "setup.mjs"), "init", "--domain", DOMAIN,
    "--web-host", `mail.${DOMAIN}`, "--login-user", "me@example.org", "--attachments"]);
  fs.writeFileSync(path.join(STATE, "state.json"), JSON.stringify({ database_id: "00000000-0000-4000-8000-000000000001" }));
  node([path.join(KIT, "scripts", "setup.mjs"), "configs"]);
  const gen = (w) => path.join(STATE, "generated", `wrangler.${w}.json`);

  // 2) 本地 D1：基础表 + 升级 + 登记域名（与 setup.mjs d1 步骤同样的 SQL）
  const d1 = (...a) => node([WRANGLER, "d1", ...a, "--local", "--persist-to", PERSIST, "-c", gen("api")]);
  d1("execute", "mailhub-db", "--yes", "--file", path.join(KIT, "schema", "0000_base.sql"));
  d1("migrations", "apply", "mailhub-db");
  d1("execute", "mailhub-db", "--yes", "--command",
    `INSERT INTO domains (id, domain, enabled, fixed_subdomain, random_subdomains, created_at) VALUES ('d1','${DOMAIN}',1,NULL,'[]',datetime('now')) ON CONFLICT(domain) DO UPDATE SET enabled = 1`);
  const tables = JSON.parse(d1("execute", "mailhub-db", "--yes", "--json", "--command",
    "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"))[0].results.map((r) => r.name);
  check(["domains", "mailboxes", "message_attachments", "messages", "sent_messages"].every((t) => tables.includes(t)),
    "建表 + 升级", tables.join(","));
  const cols = JSON.parse(d1("execute", "mailhub-db", "--yes", "--json", "--command", "PRAGMA table_info(mailboxes)"))[0].results.map((r) => r.name);
  check(cols.includes("label") && cols.includes("group_name"), "升级 0002 已生效（label / group_name）");

  // 3) 起本地数据接口与收信 Worker（共享同一个本地 D1）
  background([WRANGLER, "dev", "-c", gen("api"), "--ip", "127.0.0.1", "--port", String(API_PORT),
    "--persist-to", PERSIST, "--inspector-port", "19431", "--var", `ADMIN_TOKEN:${ADMIN}`, "--var", `SITE_PASSWORD:${SITE}`,
    "--show-interactive-dev-session=false"], "api");
  // 两个实例共用一个本地 D1：依次启动，避免同时初始化 SQLite 撞锁（SQLITE_BUSY）。
  check(await waitFor(`http://127.0.0.1:${API_PORT}/`, async (r) => r.ok), "本地数据接口启动");
  background([WRANGLER, "dev", "-c", gen("inbox"), "--ip", "127.0.0.1", "--port", String(INBOX_PORT),
    "--persist-to", PERSIST, "--inspector-port", "19432", "--show-interactive-dev-session=false"], "inbox");
  check(await waitFor(`http://127.0.0.1:${INBOX_PORT}/`, async (r) => r.status < 600), "本地收信 Worker 启动");

  // 4) 模拟一封外部来信
  const subject = `MH-E2E-${Date.now()}`;
  const raw = [
    "From: Tester <tester@example.org>",
    `To: hello@${DOMAIN}`,
    `Subject: ${subject}`,
    "Message-ID: <e2e@example.org>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "你好，这是离线自测邮件。验证码 482913",
  ].join("\r\n");
  const sent = await fetch(`http://127.0.0.1:${INBOX_PORT}/cdn-cgi/handler/email?from=tester@example.org&to=hello@${DOMAIN}`, {
    method: "POST", body: raw,
  });
  check(sent.ok, "收信 Worker 接受模拟邮件", `HTTP ${sent.status}`);

  // 5) 数据接口能查到：信箱自动建档 + 正文 + 验证码
  let found = null;
  await waitFor(`http://127.0.0.1:${API_PORT}/admin/messages/recent?limit=5`, async () => {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/admin/messages/recent?limit=5`, { headers: { "x-admin-auth": ADMIN } });
    const body = await r.json().catch(() => ({}));
    found = (body.results || body.messages || []).find((m) => m.subject === subject) || null;
    return Boolean(found);
  }, 20);
  check(Boolean(found), "数据接口查到这封信");
  check(found?.mailbox_email === `hello@${DOMAIN}`, "按收件人自动建信箱", `mailbox_email=${found?.mailbox_email}`);
  check(found?.code === "482913", "验证码提取", `code=${found?.code}`);
  const boxes = await (await fetch(`http://127.0.0.1:${API_PORT}/admin/mailboxes`, { headers: { "x-admin-auth": ADMIN } })).json();
  const box = (boxes.results || []).find((b) => b.email === `hello@${DOMAIN}`);
  check(box?.last_code === "482913", "信箱列表带出最近验证码", `last_code=${box?.last_code}`);
  const unauth = await fetch(`http://127.0.0.1:${API_PORT}/admin/messages/recent`);
  check(unauth.status === 401, "数据接口无密钥拒绝访问", `HTTP ${unauth.status}`);

  // 6) 本地版网关：免登录，经代理读到同一封信
  const vars = fs.readFileSync(path.join(STATE, "generated", ".dev.vars"), "utf8")
    .replace(/CFMAIL_ADMIN_TOKEN="[^"]*"/, `CFMAIL_ADMIN_TOKEN="${ADMIN}"`)
    .replace(/CFMAIL_SITE_PASSWORD="[^"]*"/, `CFMAIL_SITE_PASSWORD="${SITE}"`)
    + `CFMAIL_BASE_URL="http://127.0.0.1:${API_PORT}"\n`;
  fs.writeFileSync(path.join(STATE, "generated", ".dev.vars"), vars, { mode: 0o600 });
  node([path.join(KIT, "scripts", "local.mjs"), "start"]);
  const port = JSON.parse(fs.readFileSync(path.join(STATE, "local.json"), "utf8")).port;
  const st = await (await fetch(`http://127.0.0.1:${port}/auth/status`)).json();
  check(st.local === true && st.authed === true, "本地版免登录", JSON.stringify(st));
  const viaGw = await (await fetch(`http://127.0.0.1:${port}/admin/messages/recent?limit=5`)).json();
  check((viaGw.results || viaGw.messages || []).some((m) => m.subject === subject), "本地版经网关读到这封信");
  const page = await fetch(`http://127.0.0.1:${port}/inbox`);
  check(page.ok && (page.headers.get("content-type") || "").includes("text/html"), "本地版页面深链可打开", `HTTP ${page.status}`);
  node([path.join(KIT, "scripts", "local.mjs"), "stop"]);
  check(!fs.existsSync(path.join(STATE, "local.json")), "本地版停止并复核");
} catch (e) {
  console.log("❌ 自测中断：" + e.message);
  failed += 1;
} finally {
  cleanup();
  if (!failed) fs.rmSync(TMP, { recursive: true, force: true });
  else console.log(`日志保留在：${TMP}`);
}
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);

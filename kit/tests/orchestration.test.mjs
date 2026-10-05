// 离线编排测试：用假 wrangler + 本地假服务扮演 Cloudflare，跑真实的 setup.mjs。
// 覆盖：需要用户操作时停下（退出码 10）；查不到就停、不猜；不静默接管用户已有的邮箱 / 网址 / Worker；
// 密钥只经临时文件且用完即删、不进命令参数；重跑幂等；最终验收全绿；
// 以及契约测试 —— 把安装器调用过的每条 wrangler 命令拿真 wrangler 重放，确认参数都过得了它的校验。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(KIT, "..");
const REAL_WRANGLER = path.join(KIT, "node_modules", "wrangler", "bin", "wrangler.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-orch-"));
const STATE_DIR = path.join(TMP, "state");
const FAKE = path.join(TMP, "fake.json");
const DOMAIN = "demo.test";
const WEB = `mail.${DOMAIN}`;
const API = `api-mail.${DOMAIN}`;

const world = () => JSON.parse(fs.readFileSync(FAKE, "utf8"));
const patch = (p) => fs.writeFileSync(FAKE, JSON.stringify({ ...world(), ...p }, null, 2));
fs.writeFileSync(FAKE, JSON.stringify({
  loggedIn: false, tokenPermissions: [], zones: [], routing: { enabled: false, status: "unconfigured" },
  catchAll: { enabled: false, actions: [{ type: "drop", value: [] }] }, mx: [], dns: {}, dohStatus: 0,
  workerDomains: [], scripts: [], d1: [], d1Creates: 0, sql: [], secrets: {}, secretPuts: {}, deploys: [], calls: [],
}));

// 假服务：Cloudflare REST、DoH、两个「线上地址」，以及契约测试用的「拒绝一切」接口。
const server = http.createServer(async (req, res) => {
  const w = world();
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const ok = (result) => send(200, { success: true, errors: [], result });
  const api = w.secrets["mailhub-api"] || {};
  const web = w.secrets["mailhub-web"] || {};
  const p = url.pathname;
  if (p.startsWith("/contract")) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null });
  if (p === "/cf/zones") return ok(w.zones.filter((z) => z.name === url.searchParams.get("name")));
  if (p.endsWith("/email/routing/rules/catch_all")) {
    if (req.method === "PUT") {
      let body = "";
      for await (const c of req) body += c;
      const rule = JSON.parse(body);
      patch({ catchAll: { enabled: rule.enabled, actions: rule.actions } });
      return ok(rule);
    }
    return ok(w.catchAll);
  }
  if (p.endsWith("/email/routing")) return ok(w.routing);
  if (p.endsWith("/workers/domains")) return ok(w.workerDomains.filter((d) => d.hostname === url.searchParams.get("hostname")));
  if (p.endsWith("/workers/scripts")) return ok(w.scripts.map((id) => ({ id })));
  if (p === "/doh") {
    if (w.dohStatus !== 0) return send(200, { Status: w.dohStatus });
    const name = url.searchParams.get("name");
    const type = url.searchParams.get("type");
    const code = { MX: 15, A: 1, AAAA: 28, CNAME: 5 }[type];
    const data = type === "MX" && name === DOMAIN ? w.mx.map((h) => `10 ${h}.`) : (w.dns[name]?.[type] || []);
    return send(200, { Status: 0, Answer: data.map((d) => ({ type: code, data: d })) });
  }
  if (p === "/api-host/") return send(200, { ok: true, domains: 1 });
  if (p === "/api-host/admin/settings/receiving") {
    if (!api.ADMIN_TOKEN || req.headers["x-admin-auth"] !== api.ADMIN_TOKEN) return send(401, { ok: false });
    return send(200, { receive_mode: w.receiveMode ?? "registered" });
  }
  if (p === "/api-host/admin/mailboxes" || p === "/api-host/admin/new_address") {
    if (!api.ADMIN_TOKEN || req.headers["x-admin-auth"] !== api.ADMIN_TOKEN) return send(401, { ok: false });
    if (req.method === "GET") return send(200, { results: w.testBoxes || [] });
    let body = "";
    for await (const chunk of req) body += chunk;
    const { name, domain } = JSON.parse(body);
    const box = { id: "test-box", email: `${name}@${domain}`, status: "active", fingerprint: null };
    patch({ testBoxes: [box] });
    return send(200, box);
  }
  if (p === "/api-host/admin/mails") {
    if (req.headers["x-admin-auth"] !== api.ADMIN_TOKEN) return send(401, { ok: false });
    return send(200, { results: (w.testMails || {})[url.searchParams.get("address")] || [] });
  }
  if (p === "/api-host/admin/domains") {
    return req.headers["x-admin-auth"] && req.headers["x-admin-auth"] === api.ADMIN_TOKEN
      ? send(200, { ok: true, domains: [DOMAIN] }) : send(401, { ok: false });
  }
  if (p === "/web-host/") return send(200, "<html></html>", "text/html; charset=utf-8");
  if (p.startsWith("/web-host/admin/")) return send(401, { ok: false });
  if (p === "/web-host/auth/status") {
    const good = web.APP_USER && web.APP_PASSWORD && web.SESSION_SECRET &&
      web.CFMAIL_ADMIN_TOKEN === api.ADMIN_TOKEN && web.CFMAIL_SITE_PASSWORD === api.SITE_PASSWORD;
    return good ? send(200, { authed: false, configured: true }) : send(503, { ok: false });
  }
  send(404, { ok: false });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const env = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k) && !k.startsWith("CLOUDFLARE_")));
Object.assign(env, {
  MAILHUB_STATE_DIR: STATE_DIR,
  MAILHUB_WRANGLER_JS: path.join(KIT, "tests", "fixtures", "fake-wrangler.mjs"),
  MAILHUB_LOCAL_PORT: "18890",
  MAILHUB_TEST_CF_API: `${base}/cf`,
  MAILHUB_TEST_DOH: `${base}/doh`,
  MAILHUB_TEST_REWRITE: JSON.stringify({ [`https://${API}`]: `${base}/api-host`, [`https://${WEB}`]: `${base}/web-host` }),
  FAKE_STATE: FAKE,
  FAKE_DOMAIN: DOMAIN,
});

// 必须异步起子进程：假服务跑在本进程里，同步等待会把它卡死。
function runAsync(args, { input, extraEnv } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...env, ...extraEnv } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(input ?? "");
  });
}
const setup = (...args) => runAsync([path.join(KIT, "scripts", "setup.mjs"), ...args]);
const local = (...args) => runAsync([path.join(KIT, "scripts", "local.mjs"), ...args]);
const fake = (args, input) => runAsync([env.MAILHUB_WRANGLER_JS, ...args], { input });

test.after(async () => {
  await local("stop");
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("init + login：未登录时走浏览器授权（远程/无图形界面时走设备码，并把链接和验证码交给用户）", async () => {
  assert.equal((await setup("init", "--domain", DOMAIN, "--web-host", WEB, "--login-user", "me@example.org")).code, 0);
  let r = await setup("login");
  if (r.code === 10) {
    assert.match(r.out, /输入验证码：FAKE-CODE/, r.out);
    r = await setup("login");
  }
  assert.equal(r.code, 0, r.out);
  assert.equal(world().loggedIn, true);
});

test("令牌缺 Email Routing 权限 → 自动重新授权", async () => {
  patch({ tokenPermissions: ["workers_scripts:write", "d1:write", "zone:read"] });
  const before = world().calls.filter((c) => c[0] === "login").length;
  const r = await setup("login", "--device");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /输入验证码：FAKE-CODE/);
  const again = await setup("login");
  assert.equal(again.code, 0, again.out);
  assert.ok(world().calls.filter((c) => c[0] === "login").length > before, "应重新登录");
  assert.ok(world().tokenPermissions.includes("email_routing:write"));
});

test("授权已完成时忽略旧页面错误，不重新发起设备登录", async () => {
  const before = world().calls.filter((c) => c[0] === "login").length;
  const r = await setup("login", "--device");
  assert.equal(r.code, 0, r.out);
  assert.equal(world().calls.filter((c) => c[0] === "login").length, before);
});

test("域名不在账号里 → 退出码 10，并告诉用户去哪添加", async () => {
  const r = await setup("zone");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /还没有 demo\.test/);
});

test("域名待生效 → 退出码 10，并给出要改的 NS", async () => {
  patch({ zones: [{ id: "zone_1", name: DOMAIN, status: "pending", name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], account: { id: "acc_1" } }] });
  const r = await setup("zone");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /ada\.ns\.cloudflare\.com/);
  patch({ zones: [{ ...world().zones[0], status: "active" }] });
  assert.equal((await setup("zone")).code, 0);
});

test("DNS 查询失败 → 停下，不当成「没有记录」", async () => {
  patch({ dohStatus: 2 });
  const r = await setup("preflight");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /无法确认/);
  const st = JSON.parse((await setup("status", "--json")).out);
  assert.equal(st.last_error.step, "preflight", "卡在哪一步要记下来，供向用户报告现状");
  assert.equal(st.finished, false);
  patch({ dohStatus: 0 });
});

test("域名在别处收信 → 停下让用户决定；用户同意后才放行", async () => {
  patch({ mx: ["mx1.qq.com"] });
  const r = await setup("preflight");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /mx1\.qq\.com/);
  assert.equal((await setup("preflight", "--allow-existing-mx")).code, 0);
  patch({ mx: [] });
});

test("已有生效的兜底规则指向别处 → 不静默接管", async () => {
  patch({ routing: { enabled: true, status: "ready" }, catchAll: { enabled: true, actions: [{ type: "forward", value: ["someone@example.org"] }] } });
  const r = await setup("preflight");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /兜底规则/);
  patch({ routing: { enabled: false, status: "unconfigured" }, catchAll: { enabled: false, actions: [{ type: "drop", value: [] }] } });
});

test("网址已被占用 → 一次列出全部冲突；同意只对点名的地址生效，并被记住", async () => {
  patch({ dns: { [WEB]: { CNAME: ["exmail.qq.com."] }, [API]: { A: ["203.0.113.7"] } } });
  let r = await setup("preflight");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /mail\.demo\.test 已有 DNS 记录（exmail\.qq\.com）/);
  assert.match(r.out, /api-mail\.demo\.test 已有 DNS 记录（203\.0\.113\.7）/, "两个冲突要一次说清");
  r = await setup("preflight", "--take-over-host", WEB);
  assert.equal(r.code, 10, "只同意了登录网址，数据接口地址仍要停下");
  assert.doesNotMatch(r.out, /· mail\.demo\.test/);
  assert.match(r.out, /· api-mail\.demo\.test/);
  assert.equal((await setup("preflight", "--take-over-host")).code, 0);
  assert.equal((await setup("preflight")).code, 0, "同意过就记住，重跑不必再加参数");
  patch({ dns: {}, workerDomains: [{ hostname: API, service: "someone-elses-worker" }] });
  r = await setup("preflight");
  assert.equal(r.code, 0, "该地址已被用户同意占用");
  patch({ workerDomains: [] });
});

test("账号里已有同名 Worker → 停下；用户确认属于本套件后复用", async () => {
  patch({ scripts: ["mailhub-web"] });
  const r = await setup("preflight");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /已有同名 Worker：mailhub-web/);
  assert.equal((await setup("preflight", "--reuse-workers")).code, 0);
  patch({ scripts: [] });
});

test("全流程跑到「设置密码」停下（退出码 10）；密钥只经临时 600 文件、不进参数", async () => {
  fs.mkdirSync(path.join(STATE_DIR, "generated"), { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, "generated", ".secrets-web-99999.json"), "{\"LEFTOVER\":\"x\"}");
  const r = await setup("all", "--no-terminal", "--wait", "0.05");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /还在等你设置登录密码/);

  const w = world();
  assert.equal(w.d1Creates, 1);
  assert.ok(w.sql.some((q) => q.includes("INSERT INTO domains") && q.includes(DOMAIN)));
  const byWorker = Object.fromEntries(w.deploys.map((d) => [d.worker, d]));
  assert.deepEqual(byWorker["mailhub-api"].secretNames.sort(), ["ADMIN_TOKEN", "SITE_PASSWORD"]);
  assert.deepEqual(byWorker["mailhub-web"].secretNames.sort(), ["APP_USER", "CFMAIL_ADMIN_TOKEN", "CFMAIL_SITE_PASSWORD", "SESSION_SECRET"]);
  // Windows exposes synthetic mode bits; owner-only POSIX modes apply on Unix.
  if (process.platform !== "win32") {
    for (const d of w.deploys.filter((x) => x.secretsFileMode)) assert.equal(d.secretsFileMode, "600");
  }
  assert.equal(w.secrets["mailhub-web"].CFMAIL_ADMIN_TOKEN, w.secrets["mailhub-api"].ADMIN_TOKEN, "两端密钥必须一致");

  const gen = path.join(STATE_DIR, "generated");
  assert.deepEqual(fs.readdirSync(gen).filter((f) => f.startsWith(".secrets-")), [], "临时密钥文件（含上次残留）必须删除");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(gen, ".dev.vars")).mode & 0o777, 0o600);
  }

  const argvText = JSON.stringify(w.calls);
  for (const v of [...Object.values(w.secrets["mailhub-api"]), w.secrets["mailhub-web"].SESSION_SECRET]) {
    assert.ok(!argvText.includes(v), "密钥不能出现在任何命令参数里");
  }
  assert.ok(!r.out.includes(w.secrets["mailhub-api"].ADMIN_TOKEN), "密钥不能出现在输出里");

  assert.deepEqual(w.routing, { enabled: true, status: "ready" });
  assert.deepEqual(w.catchAll, { enabled: true, actions: [{ type: "worker", value: ["mailhub-inbox"] }] });
});

test("单独重跑 configs 更新失效的 Node 路径，不需要重跑建库", async () => {
  const runtimeFile = path.join(STATE_DIR, "runtime.json");
  fs.writeFileSync(runtimeFile, JSON.stringify({ execPath: path.join(TMP, "removed-node.exe"), version: "v0.0.0" }));
  const callsBefore = world().calls.length;
  const r = await setup("configs");
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeFile, "utf8")), {
    execPath: process.execPath, version: process.version,
  });
  assert.equal(world().calls.length, callsBefore, "更新运行时无需请求 Cloudflare");
});

test("用户设好密码后续跑：验收全部通过，并输出交付信息", async () => {
  const put = await fake(["secret", "put", "APP_PASSWORD", "-c", path.join(STATE_DIR, "generated", "wrangler.web.json")], "user-chosen-pw");
  assert.equal(put.code, 0);
  const r = await setup("all", "--from", "password", "--no-terminal");
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /❌/);
  assert.match(r.out, /云端登录网页：https:\/\/mail\.demo\.test/);
  assert.match(r.out, /本地版：http:\/\/127\.0\.0\.1:18890/);
  assert.equal(world().testBoxes[0].email, `test@${DOMAIN}`, "验收前必须登记测试地址");
  assert.equal(JSON.parse(fs.readFileSync(path.join(STATE_DIR, "runtime.json"), "utf8")).execPath, process.execPath);
});

test("不存在的续跑步骤不能跳过检查后报告成功", async () => {
  const r = await setup("all", "--from", "typo-step");
  assert.equal(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /机器验收全部通过/);
});

test("验收拒绝未知收信模式，不把旧部署误判为安全配置完整", async () => {
  patch({ receiveMode: "broken-mode" });
  const r = await setup("verify");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /broken-mode/);
  assert.match(r.out, /下一步：先重跑 d1/, "失败项要告诉 AI 下一步做什么，不只给原始返回值");
  patch({ receiveMode: "registered" });
  assert.equal((await setup("verify")).code, 0);
});

test("重跑幂等：自己建的网址与 Worker 不算冲突；不重复建库、不重置会话密钥、不动用户密码", async () => {
  const before = world();
  const r = await setup("all", "--no-terminal");
  assert.equal(r.code, 0, r.out);
  const after = world();
  assert.equal(after.d1Creates, 1);
  assert.equal(after.secrets["mailhub-web"].SESSION_SECRET, before.secrets["mailhub-web"].SESSION_SECRET);
  assert.equal(after.secrets["mailhub-web"].APP_PASSWORD, "user-chosen-pw");
  assert.equal(after.secretPuts.APP_PASSWORD, 1);
  assert.equal(after.secrets["mailhub-api"].ADMIN_TOKEN, before.secrets["mailhub-api"].ADMIN_TOKEN, "本机密钥复用，不轮换");
});

test("完成标准：当场重跑验收 + 查到测试信才算完成；过期的 ✅ 骗不过 confirm", async () => {
  let st = JSON.parse((await setup("status", "--json")).out);
  assert.equal(st.next_step, null, "机器步骤应全部完成");
  assert.equal(st.finished, false, "用户没确认前不算完成");
  assert.match((await setup("status")).out, /还差用户本人确认三件事/);

  let r = await setup("confirm");
  assert.equal(r.code, 10, r.out);
  assert.match(r.out, /还没查到发给 test@demo\.test 的邮件/);

  patch({ testMails: { "test@demo.test": [{ subject: "hi", received_at: "2026-09-28T10:00:00Z" }] } });
  r = await setup("confirm");
  assert.equal(r.code, 10, "登记测试地址之前就有的旧信，不能当作这次收信的证据");
  assert.match(r.out, /早于登记测试地址的时间/);

  patch({ testMails: { "test@demo.test": [{ subject: "hi", received_at: new Date().toISOString() }] } });
  // 收信路由被人关掉了：旧记录里 verify 还是 ✅，但 confirm 当场重跑验收，必须拒绝
  patch({ routing: { enabled: false, status: "disabled" } });
  r = await setup("confirm");
  assert.equal(r.code, 1, r.out);
  st = JSON.parse((await setup("status", "--json")).out);
  assert.equal(st.done.verify, undefined, "验收失败后撤销旧的完成记录");
  assert.equal(st.finished, false);

  patch({ routing: { enabled: true, status: "ready" } });
  r = await setup("confirm");
  assert.equal(r.code, 0, r.out);
  st = JSON.parse((await setup("status", "--json")).out);
  assert.equal(st.finished, true);
});

test("重新 init 只改传入的参数；换前缀后要重新检查同名 Worker", async () => {
  let r = await setup("init", "--attachments");
  assert.equal(r.code, 0, r.out);
  let cfg = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "config.json"), "utf8"));
  assert.deepEqual([cfg.domain, cfg.web_host, cfg.api_host, cfg.login_user, cfg.prefix, cfg.attachments],
    [DOMAIN, WEB, API, "me@example.org", "mailhub", true]);
  let st = JSON.parse((await setup("status", "--json")).out);
  assert.equal(st.user_confirmed, null, "配置变了，旧的确认作废");
  assert.equal(st.next_step, "zone");
  const state = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "state.json"), "utf8"));
  assert.equal(state.test_prepared, null, "配置变了，旧的测试地址登记时间也作废，confirm 要等新信");

  r = await setup("init", "--prefix", "mh2");
  assert.equal(r.code, 0, r.out);
  patch({ scripts: [...world().scripts, "mh2-web"] });
  r = await setup("preflight");
  assert.equal(r.code, 10, "换前缀 = 收信要从 mailhub-inbox 切到 mh2-inbox，必须先问");
  assert.match(r.out, /原来接收邮件的 Worker「mailhub-inbox」将不再收到新邮件/);
  r = await setup("preflight", "--take-over-catch-all");
  assert.equal(r.code, 10, "mailhub-* 是自己建的，不代表 mh2-* 也是");
  assert.match(r.out, /已有同名 Worker：mh2-web/);

  assert.equal((await setup("confirm")).code, 1, "配置变了之后，验收没重跑通过就不能记为完成");
  assert.equal((await setup("init", "--prefix", "mailhub", "--no-attachments")).code, 0);
});

test("setup.mjs wrangler 透传：长驻命令能被正常停掉（信号转发给子进程）", async () => {
  const child = spawn(process.execPath, [path.join(KIT, "scripts", "setup.mjs"), "wrangler", "dev", "--port", "18897"], { cwd: ROOT, env, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    up = await fetch("http://127.0.0.1:18897/auth/status").then((r) => r.ok).catch(() => false);
  }
  assert.ok(up, "透传的长驻命令应已启动");
  child.kill("SIGTERM");
  await new Promise((r) => child.on("close", r));
  let down = false;
  for (let i = 0; i < 20 && !down; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    down = await fetch("http://127.0.0.1:18897/auth/status").then(() => false).catch(() => true);
  }
  assert.ok(down, "父进程被停掉后，透传的子进程也必须停掉");
});

test("stop 不误杀进程号被复用的无关进程", async () => {
  await local("stop");
  const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
  fs.writeFileSync(path.join(STATE_DIR, "local.json"), JSON.stringify({ pid: bystander.pid, port: 18899 }));
  const r = await local("stop");
  assert.equal(r.code, 0, r.out);
  assert.doesNotThrow(() => process.kill(bystander.pid, 0), "无关进程必须还活着");
  assert.ok(!fs.existsSync(path.join(STATE_DIR, "local.json")));
  bystander.kill();
});

test("契约：安装器调用过的每条 wrangler 命令，参数都能通过真 wrangler 的校验", async (t) => {
  if (!fs.existsSync(REAL_WRANGLER)) return t.skip("未安装 wrangler");
  const calls = world().calls.filter((c) => !["dev", "login", "whoami"].includes(c[0]));
  const unique = [...new Map(calls.map((c) => [c.slice(0, 3).join(" ") + (c.includes("--file") ? " file" : ""), c])).values()];
  // SKILL.md 里让 agent 手动执行的命令（经 setup.mjs wrangler 透传），同样要过真 wrangler 的参数校验。
  const gen = (w) => path.join(STATE_DIR, "generated", `wrangler.${w}.json`);
  unique.push(
    ["tail", "mailhub-inbox", "--format", "pretty"],
    ["d1", "execute", "mailhub-db", "--remote", "--yes", "-c", gen("api"), "--command",
      "INSERT INTO domains (id, domain, enabled, fixed_subdomain, random_subdomains, created_at) VALUES ('domain_second_test', 'second.test', 1, NULL, '[]', datetime('now')) ON CONFLICT(domain) DO UPDATE SET enabled = 1"],
    ["email", "routing", "enable", "second.test"],
  );
  const dummy = path.join(TMP, "dummy-secrets.json");
  fs.writeFileSync(dummy, "{\"X\":\"y\"}", { mode: 0o600 });
  const argErr = /Unknown argument|Not enough non-option|Missing required argument|Invalid values|only supports|mutually exclusive/i;
  const contractEnv = {
    CLOUDFLARE_API_TOKEN: "contract-test-token",
    CLOUDFLARE_ACCOUNT_ID: "acc_1",
    CLOUDFLARE_API_BASE_URL: `${base}/contract`,
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  for (const c of unique) {
    const argv = c.map((a, i) => (c[i - 1] === "--secrets-file" ? dummy : a));
    const r = await runAsync([REAL_WRANGLER, ...argv], { input: "x", extraEnv: contractEnv });
    assert.doesNotMatch(r.out, argErr, `真 wrangler 拒绝了参数：wrangler ${argv.join(" ")}\n${r.out.slice(-600)}`);
  }
  assert.ok(unique.length >= 8, `应覆盖安装器的主要命令，实际 ${unique.length} 条`);
});

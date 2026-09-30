#!/usr/bin/env node
// MailHub 一键搭建：把「Cloudflare 账号 + 一个域名 + 这台电脑」变成
//   · 云端登录网页（任何设备登录收信）
//   · 本地版（本机一条命令启动，免登录）
//   · 默认登记后收信，可在设置中开启任意前缀自动收信
//
// 用法（给 agent 读，详见 kit/skill/mailhub-setup/SKILL.md）：
//   node kit/scripts/setup.mjs init --domain example.com --web-host mail.example.com --login-user you@gmail.com
//                                   [--api-host api-mail.example.com] [--attachments] [--prefix mailhub]
//   node kit/scripts/setup.mjs all            按顺序重跑全部步骤（复用已有资源）
//   node kit/scripts/setup.mjs <步骤名>        只跑某一步
//   node kit/scripts/setup.mjs plan           只打印计划，不做任何改动
//   node kit/scripts/setup.mjs status [--json] 现状：每步是否完成、卡在哪、下一步、是否已达成完成标准
//   node kit/scripts/setup.mjs confirm        用户本人确认可用后记为完成（要求机器验收已通过）
//   node kit/scripts/setup.mjs wrangler <参数>  透传给 kit 自带的 wrangler（自动带上账号），排障与手动操作用
//
// 退出码：0 成功 / 1 失败（看「下一步」）/ 2 配置不合法 / 10 需要用户本人操作（看「请你操作」）
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import {
  BASE_SCHEMA, DEV_VARS, EXIT, GEN_DIR, KIT, ROOT, STATE_DIR, StepError, WRANGLER_JS,
  loadState, log, needHuman, parseJsonLoose, readDevVars, readJson, reportError, saveState, sleep,
  spawnDetached, wrangler, wranglerOk, writeDevVars, writeJson,
} from "./lib/common.mjs";
import {
  configPath, loadConfig, names, saveConfig, wranglerConfigs,
} from "./lib/config.mjs";
import {
  catchAllRule, fetchx, findZone, isCloudflareMx, lookupDns, lookupMx, routingSettings,
  setCatchAllToWorker, workerDomainOf, workerNames,
} from "./lib/cf.mjs";
import { buildFrontend, installDeps } from "./lib/build.mjs";
import { start as startLocal } from "./local.mjs";
import { runChecks } from "./verify.mjs";
import { prepareTestMailbox } from "./lib/test-mailbox.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};

const randomSecret = () => crypto.randomBytes(32).toString("hex");

/**
 * 用户对某条冲突提示的同意。第一次由放行参数给出，之后记在进度文件里，重跑不必再加；
 * 同意绑定当时的对象（域名 / 地址 / 前缀），对象变了就要重新征得同意。
 */
function consented(name, subject) {
  const key = `${name}:${subject}`;
  if (flag(name)) {
    saveState({ consents: { ...(loadState().consents || {}), [key]: new Date().toISOString() } });
    return true;
  }
  return Boolean(loadState().consents?.[key]);
}

/* ── 各步骤 ─────────────────────────────────────────────── */

function stepInit() {
  // 重新 init 只改传入的参数，其余沿用已有配置 —— 否则「只想开附件」会把前缀、地址、用户名悄悄重置成默认值。
  const before = readJson(path.join(STATE_DIR, "config.json"));
  const prev = before || {};
  const domainChanged = opt("domain") !== undefined && opt("domain") !== prev.domain;
  const cfg = {
    domain: opt("domain") ?? prev.domain,
    web_host: opt("web-host") ?? prev.web_host,
    // 域名变更且未提供数据接口地址时，按当前域名重新派生接口地址。
    api_host: opt("api-host") ?? (domainChanged ? undefined : prev.api_host),
    login_user: opt("login-user") ?? prev.login_user,
    attachments: flag("attachments") ? true : flag("no-attachments") ? false : (prev.attachments ?? false),
    prefix: opt("prefix") ?? prev.prefix ?? "mailhub",
  };
  saveConfig(cfg);
  const saved = loadConfig();
  if (before && JSON.stringify(before) !== JSON.stringify(saved)) {
    // 配置变更后，完成记录与用户确认不再代表当前配置（各步可重跑，已有资源会复用）。
    const { done = {} } = loadState();
    saveState({ done: { deps: done.deps, login: done.login }, user_confirmed: null, last_error: null });
    log.info("配置有变化：已清空完成记录，接下来按当前配置重跑各步");
  }
  log.ok(`已保存配置：${path.relative(ROOT, path.join(STATE_DIR, "config.json"))}`);
  for (const [k, v] of Object.entries(saved)) log.info(`${k} = ${v}`);
}

function stepDeps() {
  installDeps({ registry: opt("registry") });
}

// 安装器用到的 OAuth 权限；老版本 wrangler 发的令牌可能缺其中几项，缺了就重新登录。
const REQUIRED_SCOPES = ["workers_scripts:write", "d1:write", "zone:read", "email_routing:write"];

/** 远程 SSH / 无图形界面：浏览器回调不到本机的 localhost:8976，改用设备码登录。 */
const headless = () => Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY)
  || (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);

function whoami() {
  const res = wrangler(["whoami", "--json"]);
  if (res.code !== 0) return null;
  try { return parseJsonLoose(res.stdout); } catch { return null; }
}

const missingScopes = (me) => (Array.isArray(me?.tokenPermissions)
  ? REQUIRED_SCOPES.filter((s) => !me.tokenPermissions.includes(s)) : []);

async function deviceLogin() {
  const logFile = path.join(STATE_DIR, "login.log");
  const running = readJson(path.join(STATE_DIR, "login.json"));
  let alive = false;
  try { alive = Boolean(running?.pid) && process.kill(running.pid, 0); } catch { /* 已退出 */ }
  if (!alive) {
    fs.rmSync(logFile, { force: true });
    const pid = spawnDetached(process.execPath, [WRANGLER_JS, "login", "--device", "--browser=false"], {
      logFile, env: { WRANGLER_SEND_METRICS: "false", CI: "" },
    });
    writeJson(path.join(STATE_DIR, "login.json"), { pid, started_at: new Date().toISOString() });
  }
  let text = "";
  for (let i = 0; i < 30 && !/enter the code/i.test(text); i += 1) {
    await sleep(1000);
    text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  }
  const url = text.match(/please visit:\s*(\S+)/i)?.[1];
  const code = text.match(/enter the code:\s*(\S+)/i)?.[1];
  if (!url || !code) throw new StepError("没拿到设备登录链接\n" + text.slice(-600), { next: "稍后重跑：node kit/scripts/setup.mjs login --device" });
  throw needHuman("请在任意设备（手机也行）的浏览器完成 Cloudflare 授权",
    `打开：${url}\n输入验证码：${code}\n授权后重跑：node kit/scripts/setup.mjs login --device\n旧页面提示 verifier 已使用时不要刷新，以此命令检查现有登录为准。`);
}

async function stepLogin() {
  let me = whoami();
  const lacking = missingScopes(me);
  if (!me || lacking.length) {
    if (lacking.length) log.info(`当前登录缺少权限（${lacking.join(", ")}），需要重新授权`);
    if (headless() || flag("device")) await deviceLogin();
    log.info("需要登录 Cloudflare：即将打开浏览器，请在页面上点「Allow / 允许」");
    const login = wrangler(["login"], { ci: false, inherit: true });
    if (login.code !== 0) {
      throw needHuman("Cloudflare 浏览器授权没有完成",
        "重跑本步骤会再次打开授权页。浏览器打不开或授权页回调失败（比如远程机器），改用：node kit/scripts/setup.mjs login --device");
    }
    me = whoami();
  }
  if (!me) throw new StepError("登录后仍无法读取账号信息", { next: "重跑：node kit/scripts/setup.mjs login" });
  const still = missingScopes(me);
  if (still.length) throw new StepError(`登录令牌缺少权限：${still.join(", ")}`, { next: "执行 wrangler logout 后重跑 login" });
  const accounts = (me.accounts || []).map((a) => ({ id: a.id, name: a.name }));
  if (!accounts.length) throw new StepError("这个 Cloudflare 登录下没有可用账号");
  saveState({ accounts, ...(accounts.length === 1 && { account_id: accounts[0].id }) });
  log.ok(`已登录 Cloudflare（${accounts.length} 个账号）`);
}

async function stepZone() {
  const cfg = loadConfig();
  const waitMin = Math.min(Number(opt("wait") || 0), 8); // 多数 agent 工具单条命令上限 10 分钟
  const deadline = Date.now() + waitMin * 60_000;
  for (;;) {
    const zone = await findZone(cfg.domain);
    if (!zone) {
      throw needHuman(`你的 Cloudflare 账号里还没有 ${cfg.domain}`,
        `1. 打开 https://dash.cloudflare.com/ → 左侧「Domains / 域」→「Onboard a domain / 添加域」\n` +
        `2. 输入 ${cfg.domain}，套餐选 Free\n` +
        `3. 页面会给出两个名称服务器（NS），去你买域名的平台，把 NS 改成这两个\n` +
        `（第 3 步生效通常几分钟到几小时。改完后重跑，我会自动等待它生效。）`);
    }
    saveState({ zone_id: zone.id, account_id: zone.account.id, zone_status: zone.status });
    if (zone.status === "active") {
      log.ok(`${cfg.domain} 已由 Cloudflare 托管（Active）`);
      return;
    }
    if (Date.now() >= deadline) {
      const ns = (zone.name_servers || []).join("  ");
      throw needHuman(`${cfg.domain} 已加入 Cloudflare，但还没生效（状态：${zone.status}）`,
        `去你买域名的平台，把名称服务器（NS）改成：${ns}\n` +
        `改完后执行：node kit/scripts/setup.mjs zone --wait 8（最多等 8 分钟，生效即继续；NS 生效有时要几小时）`);
    }
    log.info(`等待 ${cfg.domain} 生效（当前 ${zone.status}），30 秒后再查…`);
    await sleep(30_000);
  }
}

/** 接管兜底规则的后果，用用户听得懂的话说。 */
const catchAllImpact = (act) => (act?.type === "worker"
  ? `原来接收邮件的 Worker「${(act.value || []).join(", ")}」将不再收到新邮件`
  : act?.type === "forward" ? `原来转发到 ${(act.value || []).join(", ")} 的邮件将不再转发` : "原来的处理方式将停止");

/** 地址是否被别的服务占用：已绑定到别的 Worker，或已有 DNS 记录且不是我们的 Worker。 */
async function hostConflict(accountId, host, ourWorker) {
  const bound = await workerDomainOf(accountId, host);
  if (bound) return bound.service === ourWorker ? null : `已绑定到 Worker「${bound.service}」`;
  const records = [];
  for (const type of ["CNAME", "A", "AAAA"]) records.push(...await lookupDns(host, type));
  const real = records.filter((r) => [1, 5, 28].includes(r.type));
  return real.length ? `已有 DNS 记录（${real.map((r) => r.data).join(", ")}）` : null;
}

async function stepPreflight() {
  const cfg = loadConfig();
  const st = loadState();
  if (!st.zone_id) throw new StepError("还没确认域名", { next: "node kit/scripts/setup.mjs zone" });
  const n = names(cfg);
  const unknown = (what, e) => needHuman(`无法确认${what}（${e.message}）`,
    "我不会在不确定的情况下改动你的邮箱或网址。请稍后重跑本步骤；网络需要代理时先设置 HTTPS_PROXY。");

  // 1) 这个域名是不是正在别处收信（企业邮箱等）。接入会改 MX，那边就收不到了。查不到就停，不猜。
  let mx;
  try { mx = await lookupMx(cfg.domain); } catch (e) { throw unknown(` ${cfg.domain} 当前的收信设置`, e); }
  if (mx.length && !mx.every(isCloudflareMx) && !consented("allow-existing-mx", cfg.domain)) {
    throw needHuman(`${cfg.domain} 现在有别的邮箱服务在收信（MX：${mx.join(", ")}）`,
      `接入后那边会收不到信。请你决定：\n` +
      `· 不要原邮箱了：告诉我「确认放弃原邮箱」，我会加 --allow-existing-mx 继续（Cloudflare 开启收信时会替换 MX）\n` +
      `· 还要原邮箱：换一个没在收信的域名`);
  }
  log.ok(mx.length ? "MX 已指向 Cloudflare Email Routing" : "域名当前没有收信服务，可以接入");

  // 2) 已经开了 Email Routing 且兜底规则指向别处 → 不静默接管。
  const routing = await routingSettings(st.zone_id);
  if (routing?.enabled) {
    const rule = await catchAllRule(st.zone_id);
    const act = rule?.actions?.[0];
    const ours = act?.type === "worker" && (act.value || []).includes(n.inbox);
    if (rule?.enabled && !ours && act?.type !== "drop" && !consented("take-over-catch-all", cfg.domain)) {
      throw needHuman(`${cfg.domain} 已有一条生效的 Email Routing 兜底规则（${act?.type} → ${(act?.value || []).join(", ")}）`,
        `接入会把它改成交给 ${n.inbox}，${catchAllImpact(act)}。确认可以接管后，我会加 --take-over-catch-all 继续。`);
    }
  }

  // 3) 两个网址不能已被别的服务占用。wrangler 在非交互模式下会**静默覆盖**已有记录，所以必须先查。
  //    先把冲突收齐一次性告诉用户；同意按地址逐个记录，只对用户看到的那几个地址生效。
  const conflicts = [];
  for (const [host, worker] of [[cfg.web_host, n.web], [cfg.api_host, n.api]]) {
    let why;
    try { why = await hostConflict(st.account_id, host, worker); } catch (e) { throw unknown(` ${host} 是否已被占用`, e); }
    if (why) conflicts.push([host, why]);
  }
  const named = opt("take-over-host");
  const pending = conflicts.filter(([host]) => (named && named !== host
    ? !loadState().consents?.[`take-over-host:${host}`]
    : !consented("take-over-host", host)));
  if (pending.length) {
    throw needHuman(`这些地址已被占用：\n${pending.map(([h, why]) => `· ${h} ${why}`).join("\n")}`,
      "继续部署会把它们改成指向 MailHub，原来的网站或服务就打不开了。请你决定：\n" +
      "· 换地址：告诉我新地址，我重新 init\n" +
      "· 确认这些地址没在用：告诉我「确认占用」，我会加 --take-over-host 继续（只同意其中一个时用 --take-over-host <地址>）");
  }

  // 4) 账号里已有同名 Worker、但不是本套件建的 → 不覆盖。
  if (st.workers_deployed_prefix !== cfg.prefix && !consented("reuse-workers", cfg.prefix)) {
    const existing = await workerNames(st.account_id);
    const clash = [n.inbox, n.api, n.web].filter((w) => existing.has(w));
    if (clash.length) {
      throw needHuman(`你的账号里已有同名 Worker：${clash.join(", ")}`,
        "为免覆盖它们，请你决定：\n" +
        "· 它们是别的项目：告诉我一个新前缀（小写字母开头，例如 mymail），我会用 --prefix 重新 init\n" +
        "· 它们属于本套件且需要复用：告诉我「复用这些 Worker」，我会加 --reuse-workers 继续");
    }
  }
  log.ok("冲突检查通过：没有会被覆盖的邮箱、网址或 Worker");
}

function listDatabases() {
  const res = wranglerOk(["d1", "list", "--json"], {}, "列出 D1 数据库");
  return parseJsonLoose(res.stdout);
}

function writeConfigs(cfg, databaseId) {
  const all = wranglerConfigs(cfg, { databaseId });
  for (const [k, v] of Object.entries(all)) writeJson(configPath(k), v);
}

function stepD1() {
  const cfg = loadConfig();
  const n = names(cfg);
  let db = listDatabases().find((d) => d.name === n.db);
  if (!db) {
    wranglerOk(["d1", "create", n.db], {}, `创建数据库 ${n.db}`);
    db = listDatabases().find((d) => d.name === n.db);
    if (!db) throw new StepError(`创建后仍找不到数据库 ${n.db}`);
    log.ok(`已创建数据库 ${n.db}`);
  } else log.ok(`数据库已存在：${n.db}`);
  const databaseId = db.uuid || db.database_id || db.id;
  saveState({ database_id: databaseId });
  writeConfigs(cfg, databaseId);

  const c = ["-c", configPath("api")];
  wranglerOk(["d1", "execute", n.db, "--remote", "--yes", "--file", BASE_SCHEMA, ...c], {}, "建基础表");
  wranglerOk(["d1", "migrations", "apply", n.db, "--remote", ...c], {}, "执行数据库升级");
  const id = `domain_${cfg.domain.replace(/[^a-z0-9]/g, "_")}`;
  wranglerOk(["d1", "execute", n.db, "--remote", "--yes", "--command",
    `INSERT INTO domains (id, domain, enabled, fixed_subdomain, random_subdomains, created_at) ` +
    `VALUES ('${id}', '${cfg.domain}', 1, NULL, '[]', datetime('now')) ` +
    `ON CONFLICT(domain) DO UPDATE SET enabled = 1`, ...c], {}, "登记收信域名");
  log.ok(`表结构就绪，${cfg.domain} 已启用收信`);
}

function stepR2() {
  const cfg = loadConfig();
  if (!cfg.attachments) {
    log.info("未开启附件保存（attachments=false），跳过 R2");
    return;
  }
  const n = names(cfg);
  const res = wrangler(["r2", "bucket", "create", n.bucket]);
  const out = res.stdout + res.stderr;
  if (res.code === 0 || /already exists|10004/i.test(out)) {
    log.ok(`附件存储桶就绪：${n.bucket}`);
    return;
  }
  if (/10042|enable R2|purchase/i.test(out)) {
    throw needHuman("你的 Cloudflare 账号还没开通 R2（保存附件需要）",
      "打开 https://dash.cloudflare.com/ → 左侧「R2 Object Storage」→ 按提示绑定信用卡或 PayPal 并开通（免费额度 10GB，不超不扣费）。\n" +
      "不想开通也可以：告诉我「不存附件」，我会用 --no-attachments 重新 init，收信照常，只是不存附件。");
  }
  throw new StepError("创建 R2 存储桶失败\n" + out.slice(-800));
}

function stepConfigs() {
  const cfg = loadConfig();
  const { database_id: databaseId } = loadState();
  if (!databaseId) throw new StepError("还没有数据库", { next: "node kit/scripts/setup.mjs d1" });
  writeConfigs(cfg, databaseId);
  writeJson(path.join(STATE_DIR, "runtime.json"), { execPath: process.execPath, version: process.version });

  // 两把接口密钥只在本机 .dev.vars 里留一份（本地版要用），同时推给云端两个 Worker。
  const vars = readDevVars();
  const next = {
    CFMAIL_ADMIN_TOKEN: vars.CFMAIL_ADMIN_TOKEN || randomSecret(),
    CFMAIL_SITE_PASSWORD: vars.CFMAIL_SITE_PASSWORD || randomSecret(),
    LOCAL_NO_LOGIN: "1",
  };
  writeDevVars(next);
  log.ok(`已生成部署配置与本机密钥文件（${path.relative(ROOT, DEV_VARS)}，不要分享或提交）`);
}

/** 清掉上次被中断（超时 / Ctrl-C）时没来得及删除的临时密钥文件。 */
function removeSecretFiles() {
  if (!fs.existsSync(GEN_DIR)) return;
  for (const f of fs.readdirSync(GEN_DIR)) if (f.startsWith(".secrets-")) fs.rmSync(path.join(GEN_DIR, f), { force: true });
}
let activeChild = null; // `setup.mjs wrangler ...` 透传时的子进程：被中断时要一起停掉
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (activeChild) { try { activeChild.kill(sig); } catch { /* 已退出 */ } }
    removeSecretFiles();
    process.exit(130);
  });
}

/** 带密钥部署：密钥写进 600 临时文件，随版本一起上传，用完立刻删除。 */
function deployWithSecrets(which, secrets, what) {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  removeSecretFiles();
  const tmp = path.join(GEN_DIR, `.secrets-${which}-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
  try {
    return wranglerOk(["deploy", "-c", configPath(which), "--secrets-file", tmp], {
      secretValues: Object.values(secrets),
    }, what);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function customDomainHint(host) {
  return `如果报错提到 ${host} 已被占用：先运行 node kit/scripts/setup.mjs preflight 查看冲突详情，按提示处理。`;
}

function stepDeployInbox() {
  const cfg = loadConfig();
  wranglerOk(["deploy", "-c", configPath("inbox")], {}, "部署收信 Worker");
  saveState({ workers_deployed_prefix: cfg.prefix });
  log.ok(`收信 Worker 已部署：${names(cfg).inbox}`);
}

async function waitHttp(url, check, { timeoutSec = 240, init } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetchx(url, { ...init, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      if (check(res, text)) return { res, text };
      last = `HTTP ${res.status} ${text.slice(0, 120)}`;
    } catch (e) {
      last = e.cause?.code || e.message;
    }
    await sleep(5000);
  }
  throw new StepError(`${url} 在 ${timeoutSec} 秒内没有就绪（最后一次：${last}）`, {
    next: "新绑定的地址首次签发证书可能要几分钟；稍后重跑本步骤。国内网络如需代理，请设置 HTTPS_PROXY。",
  });
}

async function stepDeployApi() {
  const cfg = loadConfig();
  const vars = readDevVars();
  if (!vars.CFMAIL_ADMIN_TOKEN) throw new StepError("缺本机密钥", { next: "node kit/scripts/setup.mjs configs" });
  try {
    deployWithSecrets("api", { ADMIN_TOKEN: vars.CFMAIL_ADMIN_TOKEN, SITE_PASSWORD: vars.CFMAIL_SITE_PASSWORD }, "部署数据接口 Worker");
  } catch (e) {
    e.next = customDomainHint(cfg.api_host);
    throw e;
  }
  log.ok(`数据接口已部署：https://${cfg.api_host}`);
  await waitHttp(`https://${cfg.api_host}/admin/domains`, (res, text) => res.ok && text.includes(cfg.domain), {
    init: { headers: { "x-admin-auth": vars.CFMAIL_ADMIN_TOKEN } },
  });
  log.ok(`数据接口在线，已识别域名 ${cfg.domain}`);
}

function stepBuild() {
  buildFrontend();
}

function remoteSecretNames(which) {
  const res = wrangler(["secret", "list", "-c", configPath(which), "--format", "json"]);
  if (res.code !== 0) return null;
  try {
    return new Set(parseJsonLoose(res.stdout).map((s) => s.name));
  } catch {
    return null;
  }
}

async function stepDeployWeb() {
  const cfg = loadConfig();
  const vars = readDevVars();
  const existing = remoteSecretNames("web");
  // 读不到密钥列表时不能当成「没有」：否则会重新生成会话签名串，把所有已登录设备踢下线。
  if (!existing && loadState().web_deployed_prefix === cfg.prefix) {
    throw new StepError("读取登录网页的密钥列表失败", { next: "稍后重跑：node kit/scripts/setup.mjs deploy-web" });
  }
  const secrets = {
    APP_USER: cfg.login_user,
    CFMAIL_ADMIN_TOKEN: vars.CFMAIL_ADMIN_TOKEN,
    CFMAIL_SITE_PASSWORD: vars.CFMAIL_SITE_PASSWORD,
    // 会话签名串：已有就保留（换掉会让所有已登录设备掉线）。
    ...(!existing?.has("SESSION_SECRET") && { SESSION_SECRET: randomSecret() }),
  };
  try {
    deployWithSecrets("web", secrets, "部署登录网页");
    saveState({ web_deployed_prefix: cfg.prefix });
  } catch (e) {
    e.next = customDomainHint(cfg.web_host);
    throw e;
  }
  log.ok(`登录网页已部署：https://${cfg.web_host}`);
  await waitHttp(`https://${cfg.web_host}/admin/mailboxes?cachebust=${Date.now()}`, (res) => res.status === 401);
  log.ok("登录网页在线，未登录访问数据被正确拒绝（401）");
}

async function stepRouting() {
  const cfg = loadConfig();
  const n = names(cfg);
  const { zone_id: zoneId } = loadState();
  let routing = await routingSettings(zoneId);
  if (!routing?.enabled) {
    const res = wrangler(["email", "routing", "enable", cfg.domain]);
    if (res.code !== 0) {
      throw needHuman("没能自动开启 Email Routing",
        `打开 https://dash.cloudflare.com/ → ${cfg.domain} → Email → Email Routing → 按页面提示启用（会自动添加 MX / SPF 记录），完成后重跑。\n` +
        `（自动开启的报错：${(res.stderr || res.stdout).trim().split("\n").slice(-3).join(" ")}）`);
    }
  }
  for (let i = 0; i < 24; i += 1) {
    routing = await routingSettings(zoneId).catch(() => null);
    if (routing?.enabled && routing.status === "ready") break;
    await sleep(5000);
  }
  if (!(routing?.enabled && routing.status === "ready")) {
    throw needHuman(`Email Routing 还没就绪（状态：${routing?.status || "未知"}）`,
      `打开 https://dash.cloudflare.com/ → ${cfg.domain} → Email → Email Routing，按页面提示补全 DNS 记录后重跑。`);
  }
  log.ok("Email Routing 已开启（MX / SPF 就绪）");

  const rule = await catchAllRule(zoneId);
  const act = rule?.actions?.[0];
  const ours = rule?.enabled && act?.type === "worker" && (act.value || []).includes(n.inbox);
  if (!ours) {
    // 与 preflight 同一道保护：在两步之间有人改了规则，也不静默接管。
    if (rule?.enabled && act?.type !== "drop" && !consented("take-over-catch-all", cfg.domain)) {
      throw needHuman(`${cfg.domain} 已有一条生效的兜底规则（${act?.type} → ${(act?.value || []).join(", ")}）`,
        `接入会把它改成交给 ${n.inbox}，${catchAllImpact(act)}。确认可以接管后，我会加 --take-over-catch-all 继续。`);
    }
    try {
      await setCatchAllToWorker(zoneId, n.inbox);
    } catch (e) {
      throw needHuman("没能自动设置兜底规则（" + e.message + "）",
        `打开 https://dash.cloudflare.com/ → ${cfg.domain} → Email → Email Routing → Routing rules → Catch-all address：\n` +
        `启用，动作选「Send to a Worker」，目标选 ${n.inbox}，保存后重跑本步骤。`);
    }
  }
  const after = await catchAllRule(zoneId);
  if (!(after?.enabled && after.actions?.[0]?.type === "worker" && after.actions[0].value.includes(n.inbox))) {
    throw new StepError("兜底规则设置后复核不通过", { next: `到 Email Routing → Routing rules → Catch-all，设为 Send to a Worker → ${n.inbox}` });
  }
  log.ok(`任意前缀@${cfg.domain} 的来信都会交给 ${n.inbox}`);
}

async function stepLocal() {
  await startLocal({ open: false });
}

// 新终端窗口不会继承当前会话的环境变量（macOS Terminal 起的是新登录 shell），代理要显式带过去。
const FORWARD_ENV = ["MAILHUB_STATE_DIR", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];

/** 弹出一个终端窗口运行 set-login.mjs。弹不出（远程 / 无图形界面）返回 false。不阻塞。 */
function openLoginTerminal() {
  if (headless()) return false;
  const script = path.join(KIT, "scripts", "set-login.mjs");
  const node = process.execPath;
  const fwd = Object.fromEntries(FORWARD_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  if (process.platform === "darwin") {
    const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
    const envs = Object.entries(fwd).map(([k, v]) => `export ${k}=${q(v)}; `).join("");
    const cmd = `cd ${q(ROOT)} && ${envs}${q(node)} ${q(script)}`;
    const as = `tell application "Terminal"\n activate\n do script "${cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\nend tell`;
    return spawnSync("osascript", ["-e", as], { stdio: "ignore" }).status === 0;
  }
  if (process.platform === "win32") {
    // `start` 的第一个带引号参数是窗口标题，必须显式给空标题；路径含空格时由 .cmd 文件负责引号。
    const bat = path.join(STATE_DIR, "set-login.cmd");
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(bat, `@echo off\r\nchcp 65001 >nul\r\ncd /d "${ROOT}"\r\n"${node}" "${script}"\r\npause\r\n`);
    return spawnSync("cmd.exe", [`/c start "" "${bat}"`], {
      stdio: "ignore", windowsVerbatimArguments: true, env: { ...process.env, ...fwd },
    }).status === 0;
  }
  for (const [term, pre] of [["x-terminal-emulator", ["-e"]], ["gnome-terminal", ["--"]], ["konsole", ["-e"]], ["xterm", ["-e"]]]) {
    if (spawnSync("sh", ["-c", `command -v ${term}`]).status === 0) {
      spawnDetached(term, [...pre, node, script], { cwd: ROOT, logFile: path.join(STATE_DIR, "terminal.log"), env: fwd });
      return true;
    }
  }
  return false;
}

async function stepPassword() {
  const has = () => remoteSecretNames("web")?.has("APP_PASSWORD");
  if (has()) {
    log.ok("登录密码已设置");
    return;
  }
  const q = (v) => `'${v.replace(/'/g, process.platform === "win32" ? "''" : "'\\''")}'`;
  const manual = `${process.platform === "win32" ? "& " : ""}${q(process.execPath)} ${q(path.join(KIT, "scripts", "set-login.mjs"))}`;
  const opened = !flag("no-terminal") && openLoginTerminal();
  if (opened) log.info("已请求打开终端窗口；如果能看到，请在里面设置登录密码（输入时不显示，不经过聊天）");
  log.info(`如果没有窗口，请在你自己的${process.platform === "win32" ? " PowerShell" : "终端"}里执行：${manual}`);
  const waitMin = Math.min(Number(opt("wait") || 8), 8); // 多数 agent 工具单条命令上限 10 分钟
  const deadline = Date.now() + waitMin * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (has()) {
      log.ok("登录密码已设置");
      return;
    }
  }
  throw needHuman("还在等你设置登录密码",
    `${opened ? "在弹出的终端窗口里" : "在你的终端里执行 " + manual + "，"}按提示输入两次密码。设置好后重跑：node kit/scripts/setup.mjs password`);
}

async function stepVerify() {
  const ok = await runChecks({ print: true });
  if (!ok) throw new StepError("有检查项未通过（见上表）", { next: "按失败项的提示处理后重跑：node kit/scripts/setup.mjs verify" });
}

async function stepPrepareTest() {
  const cfg = loadConfig();
  const vars = readDevVars();
  const address = await prepareTestMailbox({ domain: cfg.domain, address: opt("mail"),
    request: async (route, { method = "GET", body } = {}) => {
      const res = await fetchx(`https://${cfg.api_host}${route}`, {
        method, headers: { "x-admin-auth": vars.CFMAIL_ADMIN_TOKEN || "", "content-type": "application/json" },
        ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new StepError(`准备测试邮箱失败（HTTP ${res.status}）`, { next: "检查 deploy-api、域名是否启用和数据库迁移后重跑 prepare-test" });
      return res.json();
    },
  });
  log.ok(`测试收件地址已登记：${address}（已有邮件保留）`);
  log.info("现在请用户用自己的外部邮箱发一封信；此命令不会发送邮件，也不代表收信验收已通过。");
}

/* ── 编排 ──────────────────────────────────────────────── */

const STEPS = [
  ["deps", "安装依赖", stepDeps],
  ["login", "登录 Cloudflare", stepLogin],
  ["zone", "确认域名已由 Cloudflare 托管", stepZone],
  ["preflight", "冲突检查：邮箱 / 兜底规则 / 网址 / 同名 Worker", stepPreflight],
  ["d1", "数据库", stepD1],
  ["r2", "附件存储（可选）", stepR2],
  ["configs", "生成部署配置与密钥", stepConfigs],
  ["deploy-inbox", "部署收信 Worker", stepDeployInbox],
  ["deploy-api", "部署数据接口", stepDeployApi],
  ["build", "构建网页", stepBuild],
  ["deploy-web", "部署登录网页", stepDeployWeb],
  ["routing", "开启收信路由", stepRouting],
  ["local", "启动本地版", stepLocal],
  ["password", "设置登录密码（需要你本人输入）", stepPassword],
  ["prepare-test", "登记测试收件地址（不发送邮件）", stepPrepareTest],
  ["verify", "全链路验收", stepVerify],
];

function printPlan() {
  const cfg = loadConfig();
  const n = names(cfg);
  console.log("将要在你的 Cloudflare 账号里创建 / 配置：");
  console.log(`  · 数据库 D1：${n.db}`);
  if (cfg.attachments) console.log(`  · 附件存储 R2：${n.bucket}`);
  console.log(`  · 收信 Worker：${n.inbox}（默认仅接收已登记地址，可在设置中切换自动模式）`);
  console.log(`  · 数据接口：https://${cfg.api_host}（Worker ${n.api}）`);
  console.log(`  · 登录网页：https://${cfg.web_host}（Worker ${n.web}，登录名 ${cfg.login_user}）`);
  console.log(`  · ${cfg.domain} 的 Email Routing：开启，兜底规则 → ${n.inbox}`);
  console.log(`本机：本地版 http://127.0.0.1:8790 起（免登录，只允许本机访问）`);
  console.log(`步骤：${STEPS.map(([k]) => k).join(" → ")}`);
}

/** 跑一步并记账：成功记完成时间，失败记是哪一步、为什么 —— `status` 靠它向用户报告现状。 */
async function runStep([key, title, fn]) {
  log.step(key, title);
  try {
    await fn();
  } catch (err) {
    const { done = {} } = loadState();
    delete done[key]; // 这一步现在是失败的：旧的「已完成」记录不再代表现状
    saveState({ done, last_error: { step: key, code: err.code ?? EXIT.FAIL, message: String(err.message).slice(0, 400), at: new Date().toISOString() } });
    throw err;
  }
  const st = loadState();
  saveState({ last_step: key, done: { ...(st.done || {}), [key]: new Date().toISOString() },
    ...(st.last_error?.step === key && { last_error: null }) });
}

/**
 * 记为完成：当场重跑全部验收（不信旧记录），并到数据接口里查到用户发的测试信 ——
 * 「收到测试信」要有证据，不只凭一句「收到了」。
 */
async function confirmDone() {
  const cfg = loadConfig();
  log.step("confirm", "确认完成");
  if (!(await runChecks({ print: true }))) {
    const { done = {} } = loadState();
    delete done.verify;
    saveState({ done });
    throw new StepError("机器验收没有全部通过，不能记为完成", { next: "按上表失败项处理后重跑 verify" });
  }
  const address = (opt("mail") || `test@${cfg.domain}`).toLowerCase();
  const vars = readDevVars();
  let found = [];
  try {
    const res = await fetchx(`https://${cfg.api_host}/admin/mails?address=${encodeURIComponent(address)}&limit=1`,
      { headers: { "x-admin-auth": vars.CFMAIL_ADMIN_TOKEN || "" } });
    found = res.ok ? ((await res.json()).results || []) : [];
  } catch { found = []; }
  if (!found.length) {
    throw needHuman(`还没查到发给 ${address} 的邮件`,
      `先用 prepare-test --mail ${address} 登记地址，再用你自己的 Gmail / QQ 等邮箱发一封信，一分钟后再确认。\n` +
      `如果你发到了别的地址，告诉我那个地址，我会用 --mail <地址> 查。`);
  }
  const { done = {} } = loadState();
  saveState({ done: { ...done, verify: new Date().toISOString() }, user_confirmed: new Date().toISOString(), test_mail: { address, received_at: found[0].received_at || null } });
  log.ok(`已查到发给 ${address} 的测试信；已记录用户确认。搭建任务完成。`);
}

/** 现状报告：每步是否完成、卡在哪、下一步跑什么、是否已达成完成标准。 */
function printStatus() {
  const cfgRaw = readJson(path.join(STATE_DIR, "config.json"));
  const st = loadState();
  const done = st.done || {};
  const next = STEPS.find(([k]) => !done[k])?.[0] || null;
  const finished = Boolean(done.verify && st.user_confirmed);
  if (flag("json")) {
    console.log(JSON.stringify({ configured: Boolean(cfgRaw), config: cfgRaw, done, next_step: next,
      last_error: st.last_error || null, user_confirmed: st.user_confirmed || null, finished }, null, 2));
    return;
  }
  if (!cfgRaw) {
    console.log("还没有开始：先问询用户，再执行 init（见 SKILL.md 第 4 节）。");
    return;
  }
  console.log(`域名 ${cfgRaw.domain}　登录网页 https://${cfgRaw.web_host}　数据接口 https://${cfgRaw.api_host}　登录名 ${cfgRaw.login_user}`);
  for (const [key, title] of STEPS) {
    const mark = done[key] ? "✅" : st.last_error?.step === key ? "❌" : "⬜";
    console.log(`  ${mark} ${key.padEnd(13)} ${title}`);
  }
  if (st.last_error) console.log(`\n上次卡在「${st.last_error.step}」（退出码 ${st.last_error.code}）：${st.last_error.message.split("\n")[0]}`);
  if (next) console.log(`\n下一步：node kit/scripts/setup.mjs ${next}`);
  else if (!st.user_confirmed) console.log("\n机器验收已全部通过。还差用户本人确认三件事（见 SKILL.md 第 8 节），确认后执行：node kit/scripts/setup.mjs confirm");
  console.log(finished ? `\n🎉 已完成：机器验收全绿，用户已于 ${st.user_confirmed} 确认可用。` : "\n⏳ 尚未完成。");
}

async function main() {
  const [cmd = "help"] = args;
  if (cmd === "init") return stepInit();
  if (cmd === "plan") return printPlan();
  if (cmd === "status") return printStatus();
  if (cmd === "wrangler") {
    // 透传给 kit 自带的 wrangler，并自动带上已确认的 Cloudflare 账号（多账号时直接调用会报错）。
    // 异步起子进程：像 `tail` 这种一直运行的命令，被停止时信号才能转发过去。
    const accountId = loadState().account_id;
    activeChild = spawn(process.execPath, [WRANGLER_JS, ...args.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true", ...(accountId && { CLOUDFLARE_ACCOUNT_ID: accountId }) },
    });
    return new Promise((resolve) => activeChild.on("close", (code) => resolve(code ?? EXIT.FAIL)));
  }
  if (cmd === "confirm") return confirmDone();
  if (cmd === "all") {
    loadConfig();
    const from = opt("from");
    if (flag("from") && !STEPS.some(([key]) => key === from)) {
      throw new StepError("--from 必须指定一个有效步骤", { code: EXIT.BAD_INPUT });
    }
    let started = !from;
    for (const step of STEPS) {
      if (!started && step[0] === from) started = true;
      if (!started) continue;
      await runStep(step);
    }
    console.log("\n🎉 机器验收全部通过。接下来请用户本人确认三件事（SKILL.md 第 8 节）。");
    return;
  }
  const step = STEPS.find(([k]) => k === cmd);
  if (!step) {
    console.log("用法：node kit/scripts/setup.mjs init|plan|status|all|confirm|<步骤>\n步骤：" + STEPS.map(([k]) => k).join(", "));
    return EXIT.BAD_INPUT;
  }
  if (!["deps", "build"].includes(cmd)) loadConfig(); // 这两步不读配置：全新克隆（含 CI）可直接运行
  await runStep(step);
}

try {
  const code = await main();
  process.exit(code ?? EXIT.OK);
} catch (err) {
  process.exit(reportError(err));
}

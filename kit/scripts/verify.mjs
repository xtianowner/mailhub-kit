#!/usr/bin/env node
// 全链路验收：每一项都打真实地址，按真实返回判定；最后打印给用户的交付信息。
//   node kit/scripts/verify.mjs          退出码 0 = 全部通过
import path from "node:path";

import { DEV_VARS, EXIT, KIT, LOCAL_RUN, ROOT, loadState, readDevVars, readJson, reportError, saveState } from "./lib/common.mjs";
import { loadConfig, names } from "./lib/config.mjs";
import { catchAllRule, fetchx, isCloudflareMx, lookupMx, routingSettings } from "./lib/cf.mjs";

async function get(url, init) {
  const res = await fetchx(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, type: res.headers.get("content-type") || "", text, json };
}

export async function runChecks({ print = true } = {}) {
  const cfg = loadConfig();
  const n = names(cfg);
  const { zone_id: zoneId } = loadState();
  const vars = readDevVars();
  const local = readJson(LOCAL_RUN);
  const api = `https://${cfg.api_host}`;
  const web = `https://${cfg.web_host}`;
  const admin = { headers: { "x-admin-auth": vars.CFMAIL_ADMIN_TOKEN || "" } };

  const checks = [
    ["数据接口在线", async () => {
      const r = await get(api + "/");
      return [r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`];
    }],
    ["数据接口认得你的域名", async () => {
      const r = await get(api + "/admin/domains", admin);
      return [Boolean(r.json?.domains?.includes(cfg.domain)), `domains=${JSON.stringify(r.json?.domains ?? r.status)}`];
    }],
    ["登录网页可打开", async () => {
      const r = await get(web + "/");
      return [r.status === 200 && r.type.includes("text/html"), `HTTP ${r.status}`];
    }],
    ["收信模式可读取且有效", async () => {
      const r = await get(api + "/admin/settings/receiving", admin);
      const mode = r.json?.receive_mode;
      return [r.status === 200 && ["registered", "auto"].includes(mode),
        mode === "auto" ? "auto（任意地址收信；如需限制，请在设置切回登记模式）" : `HTTP ${r.status} mode=${mode ?? "缺失（检查迁移与 API 部署）"}`];
    }],
    ["未授权不能读取收信设置", async () => {
      const r = await get(api + "/admin/settings/receiving");
      return [r.status === 401, `HTTP ${r.status}（应为 401）`];
    }],
    ["未登录访问数据被拒绝", async () => {
      const r = await get(`${web}/admin/mailboxes?cachebust=${Date.now()}`);
      return [r.status === 401, `HTTP ${r.status}（应为 401）`];
    }],
    ["登录网页配置完整（含登录密码）", async () => {
      const r = await get(`${web}/auth/status?cachebust=${Date.now()}`);
      return [r.status === 200 && r.json?.configured === true, r.status === 503 ? "缺登录密码等设置" : `HTTP ${r.status}`];
    }],
    ["收信路由已开启", async () => {
      const s = await routingSettings(zoneId);
      return [s?.enabled === true && s.status === "ready", `enabled=${s?.enabled} status=${s?.status}`];
    }],
    ["任意前缀的来信交给收信 Worker", async () => {
      const r = await catchAllRule(zoneId);
      const a = r?.actions?.[0];
      return [Boolean(r?.enabled && a?.type === "worker" && a.value?.includes(n.inbox)), `${a?.type} → ${(a?.value || []).join(",")}`];
    }],
    ["公网 MX 指向 Cloudflare", async () => {
      const mx = await lookupMx(cfg.domain);
      return [Boolean(mx?.length && mx.every(isCloudflareMx)), mx ? mx.join(", ") || "无 MX" : "查询失败"];
    }],
    ["本地版运行中且免登录", async () => {
      if (!local) return [false, `未启动（${process.platform === "win32" ? "start.cmd" : "./start.sh"}）`];
      const r = await get(`http://127.0.0.1:${local.port}/auth/status`);
      return [r.json?.local === true && r.json?.authed === true, `http://127.0.0.1:${local.port}`];
    }],
    ["本地版能读到云端数据", async () => {
      if (!local) return [false, "未启动"];
      const r = await get(`http://127.0.0.1:${local.port}/admin/domains`);
      return [Boolean(r.json?.domains?.includes(cfg.domain)), `HTTP ${r.status}`];
    }],
  ];

  let allOk = true;
  if (print) console.log("\n   验收项                              结果   实际返回");
  for (const [title, fn] of checks) {
    let ok = false;
    let detail = "";
    try {
      [ok, detail] = await fn();
    } catch (e) {
      detail = e.cause?.code || e.message;
    }
    allOk &&= ok;
    if (print) console.log(`   ${ok ? "✅" : "❌"} ${title.padEnd(28, "　").slice(0, 28)} ${detail}`);
  }

  if (print && allOk) {
    const rel = (p) => path.relative(ROOT, p) || ".";
    console.log(`
────────── 交付信息（请原样告诉用户）──────────
☁️  云端登录网页：${web}
    用户名：${cfg.login_user}（不区分大小写）　密码：你刚才在终端里设置的那个
    手机 / 任何设备都能登录，两周内免重复登录。
💻 本地版：http://127.0.0.1:${local?.port}
    启动：${path.join(ROOT, process.platform === "win32" ? "start.cmd" : "start.sh")}
    停止：${path.join(ROOT, process.platform === "win32" ? "stop.cmd" : "stop.sh")}
    只允许本机访问，免登录；数据与云端是同一份。
📮 收信：按网页「设置 → 收信模式」执行；默认只接收已登记的地址。
    登记模式请先在「域名邮箱」创建地址；自动模式首次来信会自动建信箱。
    自测：先登记 test@${cfg.domain}，再用你的 Gmail / QQ 邮箱发一封信，一分钟内到登录网页里查看。
🔌 数据接口（二次开发用）：${api}
    密钥在本机 ${DEV_VARS}（CFMAIL_ADMIN_TOKEN / CFMAIL_SITE_PASSWORD）
    接口说明：${path.join(KIT, "docs", "data-api.md")}
🔑 改登录密码：node ${rel(path.join(KIT, "scripts", "set-login.mjs"))}
──────────────────────────────────────────────
机器验收已全部通过。请用户亲自确认三件事，都没问题后执行 node kit/scripts/setup.mjs confirm：
  ① 用自己的密码登录云端网页   ② 发给 test@${cfg.domain} 的信在网页里看到了   ③ 本地版能打开`);
  }
  return allOk;
}

if (process.argv[1]?.endsWith("verify.mjs")) {
  try {
    const ok = await runChecks();
    // 与 setup.mjs verify 同样记账：通过记完成时间，失败撤销旧的完成记录（不让过期的 ✅ 骗过 confirm）。
    const { done = {} } = loadState();
    if (ok) done.verify = new Date().toISOString();
    else delete done.verify;
    saveState({ done });
    process.exit(ok ? EXIT.OK : EXIT.FAIL);
  } catch (err) {
    process.exit(reportError(err));
  }
}

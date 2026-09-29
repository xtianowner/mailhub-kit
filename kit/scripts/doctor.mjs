#!/usr/bin/env node
// 环境自检：只读，不改任何东西。agent 据此决定要不要先帮用户装东西。
//   node kit/scripts/doctor.mjs [--json]      退出码 0 = 可以开始搭建
import fs from "node:fs";
import path from "node:path";

import { FRONTEND_DIR, KIT, WORKER_DIR, WRANGLER_JS, run } from "./lib/common.mjs";

const MIN_NODE = 22;

async function reach(url) {
  try {
    const { fetchx } = await import("./lib/cf.mjs");
    const res = await fetchx(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    return { ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e.cause?.code || e.message };
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const major = Number(process.versions.node.split(".")[0]);
  const depsReady = [KIT, WORKER_DIR, FRONTEND_DIR].every((d) => fs.existsSync(path.join(d, "node_modules")));
  const git = run(process.platform === "win32" ? "where" : "which", ["git"]);
  const proxySet = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].some((k) => process.env[k]);
  const checks = [
    { key: "node", ok: major >= MIN_NODE, detail: `v${process.versions.node}（需要 ≥ ${MIN_NODE}）`, fix: "安装 Node.js 22 LTS 或更新版本" },
    { key: "deps", ok: depsReady, detail: depsReady ? "已安装" : "未安装", fix: "node kit/scripts/setup.mjs deps", blocking: false },
    { key: "wrangler", ok: fs.existsSync(WRANGLER_JS), detail: fs.existsSync(WRANGLER_JS) ? "kit 自带" : "随依赖安装", fix: "node kit/scripts/setup.mjs deps", blocking: false },
    { key: "npm_registry", ...(await reach("https://registry.npmjs.org/wrangler")), fix: "国内网络：安装依赖时加 --registry https://registry.npmmirror.com", blocking: false },
    // 设了代理但依赖还没装时，这里的探测走不了代理，失败不代表真不通 —— 只提示，不拦截。
    { key: "cloudflare_api", ...(await reach("https://api.cloudflare.com/client/v4/ips")), fix: "检查网络；如需代理，在当前终端设置 HTTPS_PROXY",
      ...(proxySet && !depsReady && { blocking: false, fix: "设了代理但依赖未装，暂时测不准：先执行 setup.mjs deps 再重跑 doctor" }) },
    { key: "git", ok: git.code === 0, detail: git.code === 0 ? "可用" : "未安装（可选，仅用于以后更新）", blocking: false },
  ];
  const ready = checks.every((c) => c.ok || c.blocking === false);
  if (json) {
    console.log(JSON.stringify({ ready, platform: process.platform, arch: process.arch, checks }, null, 2));
  } else {
    for (const c of checks) console.log(`${c.ok ? "✅" : c.blocking === false ? "⚠️ " : "❌"} ${c.key.padEnd(15)} ${c.detail}${c.ok ? "" : "　→ " + c.fix}`);
    console.log(ready ? "\n可以开始搭建。" : "\n先处理 ❌ 项。");
  }
  process.exit(ready ? 0 : 1);
}

await main();

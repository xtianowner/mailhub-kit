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

/** 冲突检查和验收都要查公网 DNS；DoH 解析器全部连不上时 preflight 会一直停在「无法确认」。 */
async function dohReach() {
  try {
    const { lookupDns } = await import("./lib/cf.mjs");
    await lookupDns("cloudflare.com", "A");
    return { ok: true, detail: "可用" };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

/** git 只用于以后更新。macOS 没装命令行工具时 /usr/bin/git 是个壳：which 找得到，一执行就弹安装框并失败。 */
function gitAvailable() {
  try {
    const found = run(process.platform === "win32" ? "where" : "which", ["git"]);
    if (found.code !== 0) return false;
    if (process.platform === "darwin" && found.stdout.trim().split("\n")[0] === "/usr/bin/git") {
      return run("xcode-select", ["-p"]).code === 0;
    }
    return run("git", ["--version"]).code === 0;
  } catch {
    return false;
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const major = Number(process.versions.node.split(".")[0]);
  const depsReady = [KIT, WORKER_DIR, FRONTEND_DIR].every((d) => fs.existsSync(path.join(d, "node_modules")));
  const git = gitAvailable();
  const proxySet = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].some((k) => process.env[k]);
  const checks = [
    { key: "node", ok: major >= MIN_NODE, detail: `v${process.versions.node}（需要 ≥ ${MIN_NODE}；推荐最新 22 / 24 LTS）`, fix: "安装官方 Node.js LTS，或使用项目便携运行时" },
    { key: "runtime", ok: true, detail: `${process.platform}/${process.arch} ${process.execPath}` },
    { key: "deps", ok: depsReady, detail: depsReady ? "已安装" : "未安装", fix: "node kit/scripts/setup.mjs deps", blocking: false },
    { key: "wrangler", ok: fs.existsSync(WRANGLER_JS), detail: fs.existsSync(WRANGLER_JS) ? "kit 自带" : "随依赖安装", fix: "node kit/scripts/setup.mjs deps", blocking: false },
    { key: "npm_registry", ...(await reach("https://registry.npmjs.org/wrangler")), fix: "国内网络：安装依赖时加 --registry https://registry.npmmirror.com", blocking: false },
    // 设了代理但依赖还没装时，这里的探测走不了代理，失败不代表真不通 —— 只提示，不拦截。
    { key: "cloudflare_api", ...(await reach("https://api.cloudflare.com/client/v4/ips")), fix: "检查网络；如需代理，在当前终端设置 HTTPS_PROXY",
      ...(proxySet && !depsReady && { blocking: false, fix: "设了代理但依赖未装，暂时测不准：先执行 setup.mjs deps 再重跑 doctor" }) },
    { key: "dns_query", ...(await dohReach()), fix: "公网 DNS 查询全部不通：国内网络请开代理（TUN 模式，或在每条命令前带上 HTTPS_PROXY）后重跑",
      ...(proxySet && !depsReady && { blocking: false, fix: "设了代理但依赖未装，暂时测不准：先执行 setup.mjs deps 再重跑 doctor" }) },
    { key: "git", ok: git, detail: git ? "可用" : "不可用（可选，仅用于以后更新；没有 git 时按 SKILL 第 10 节的 zip 方式更新）", blocking: false },
  ];
  const ready = checks.every((c) => c.ok || c.blocking === false);
  if (json) {
    console.log(JSON.stringify({ ready, platform: process.platform, arch: process.arch, execPath: process.execPath, checks }, null, 2));
  } else {
    for (const c of checks) console.log(`${c.ok ? "✅" : c.blocking === false ? "⚠️ " : "❌"} ${c.key.padEnd(15)} ${c.detail}${c.ok ? "" : "　→ " + c.fix}`);
    console.log(ready ? "\n可以开始搭建。" : "\n先处理 ❌ 项。");
  }
  process.exit(ready ? 0 : 1);
}

await main();

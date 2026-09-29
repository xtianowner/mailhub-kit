#!/usr/bin/env node
// 本地版：在本机跑「云端同款网页」（wrangler dev 起网关 Worker），数据仍在 Cloudflare。
// 只绑 127.0.0.1，免登录；停服会复核进程与端口真的释放。
//
//   node kit/scripts/local.mjs start [--open]   启动（已在跑则复用）
//   node kit/scripts/local.mjs stop             停止并复核
//   node kit/scripts/local.mjs status           查看状态
import fs from "node:fs";
import net from "node:net";
import { spawnSync } from "node:child_process";

import {
  DEV_VARS, EXIT, GEN_DIR, LOCAL_LOG, LOCAL_RUN, StepError, WRANGLER_JS,
  log, readDevVars, readJson, reportError, sleep, spawnDetached, writeJson,
} from "./lib/common.mjs";
import { configPath } from "./lib/config.mjs";
import { buildFrontend, frontendBuilt } from "./lib/build.mjs";

const HOST = "127.0.0.1";
const BASE_PORT = Number(process.env.MAILHUB_LOCAL_PORT || 8790);
const MAX_PORT = BASE_PORT + 12;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, HOST, () => srv.close(() => resolve(true)));
  });
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

async function probe(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/auth/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 进程的完整命令行；拿不到返回 null。 */
function commandLine(pid) {
  const res = process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: "utf8" })
    : spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() || null : null;
}

/** 记录里的进程确实是本地版：端口按本地版的方式应答，或命令行是 wrangler dev。 */
async function isOurs(run) {
  if ((await probe(run.port))?.local === true) return true;
  const cmd = commandLine(run.pid);
  return Boolean(cmd && cmd.includes("wrangler") && cmd.includes(" dev"));
}

function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  // detached 启动 → 它是进程组组长；对负 pid 发信号能连同 workerd 子进程一起停。
  for (const sig of ["SIGTERM"]) {
    try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* 已退出 */ } }
  }
}

async function start({ open }) {
  const run = readJson(LOCAL_RUN);
  if (run && alive(run.pid) && (await probe(run.port))?.local) {
    log.ok(`本地版已在运行：http://${HOST}:${run.port}`);
    if (open) openBrowser(`http://${HOST}:${run.port}`);
    return run.port;
  }
  if (run) fs.rmSync(LOCAL_RUN, { force: true });

  const vars = readDevVars();
  if (!vars.CFMAIL_ADMIN_TOKEN || !vars.CFMAIL_SITE_PASSWORD || vars.LOCAL_NO_LOGIN !== "1") {
    throw new StepError("本地配置不完整（缺接口密钥或免登录开关）", {
      next: "先完成云端部署：node kit/scripts/setup.mjs all",
    });
  }
  if (!fs.existsSync(configPath("web-local"))) {
    throw new StepError("缺网关配置文件", { next: "node kit/scripts/setup.mjs all" });
  }
  if (!frontendBuilt()) buildFrontend();

  let port = BASE_PORT;
  while (port <= MAX_PORT && !(await portFree(port))) port += 1;
  if (port > MAX_PORT) throw new StepError(`${BASE_PORT}-${MAX_PORT} 端口都被占用`, { next: "设置 MAILHUB_LOCAL_PORT=其它起始端口 后重试" });
  // 调试端口默认固定 9229：本机另开着 wrangler / Node 调试时会直接起不来，所以也挑一个空闲的。
  let inspector = 9330;
  while (inspector < 9400 && !(await portFree(inspector))) inspector += 1;

  const pid = spawnDetached(process.execPath, [
    WRANGLER_JS, "dev", "-c", configPath("web-local"),
    "--ip", HOST, "--port", String(port), "--inspector-port", String(inspector),
    "--show-interactive-dev-session=false",
  ], { cwd: GEN_DIR, logFile: LOCAL_LOG, env: { WRANGLER_SEND_METRICS: "false" } });
  writeJson(LOCAL_RUN, { pid, port, started_at: new Date().toISOString() });

  for (let i = 0; i < 90; i += 1) {
    await sleep(1000);
    const st = await probe(port);
    if (st?.local && st.configured) {
      log.ok(`本地版已启动：http://${HOST}:${port}`);
      log.info(`日志：${LOCAL_LOG}　停止：./stop.sh（Windows：stop.cmd）`);
      if (open) openBrowser(`http://${HOST}:${port}`);
      return port;
    }
    if (!alive(pid)) break;
  }
  killTree(pid);
  fs.rmSync(LOCAL_RUN, { force: true });
  const tail = fs.existsSync(LOCAL_LOG) ? fs.readFileSync(LOCAL_LOG, "utf8").split("\n").slice(-20).join("\n") : "";
  throw new StepError(`本地版没能启动\n${tail}`, { next: `完整日志：${LOCAL_LOG}` });
}

async function stop() {
  const run = readJson(LOCAL_RUN);
  if (!run) {
    log.ok("本地版没有在运行");
    return;
  }
  if (alive(run.pid) && !(await isOurs(run))) {
    // 电脑重启后进程号可能被别的程序复用：不是本地版就绝不动它。
    fs.rmSync(LOCAL_RUN, { force: true });
    log.ok("本地版没有在运行（清理了过期的运行记录，未动任何其它进程）");
    return;
  }
  if (alive(run.pid)) killTree(run.pid);
  for (let i = 0; i < 20 && (alive(run.pid) || !(await portFree(run.port))); i += 1) await sleep(500);
  if (alive(run.pid) && process.platform !== "win32") {
    try { process.kill(-run.pid, "SIGKILL"); } catch { /* 已退出 */ }
    await sleep(500);
  }
  const stillAlive = alive(run.pid);
  const portBusy = !(await portFree(run.port));
  if (stillAlive || portBusy) {
    throw new StepError(`停止后复核未通过：进程${stillAlive ? "仍在" : "已退出"}，端口 ${run.port} ${portBusy ? "仍被占用" : "已释放"}`, {
      next: "稍等几秒重跑 stop；仍不行请手动结束该进程",
    });
  }
  fs.rmSync(LOCAL_RUN, { force: true });
  log.ok(`本地版已停止（进程已退出，端口 ${run.port} 已释放）`);
}

async function status() {
  const run = readJson(LOCAL_RUN);
  const st = run && alive(run.pid) ? await probe(run.port) : null;
  if (st?.local) log.ok(`运行中：http://${HOST}:${run.port}`);
  else log.info("未运行（启动：./start.sh，Windows：start.cmd）");
  return st?.local ? EXIT.OK : 3;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  spawnSync(cmd, args, { stdio: "ignore" });
}

export { start, stop };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("local.mjs")) {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const open = rest.includes("--open");
  const actions = { start: () => start({ open }), stop, status };
  if (!actions[cmd]) {
    console.log("用法：node kit/scripts/local.mjs start|stop|status [--open]");
    process.exit(EXIT.BAD_INPUT);
  }
  try {
    const code = await actions[cmd]();
    process.exit(typeof code === "number" && cmd === "status" ? code : EXIT.OK);
  } catch (err) {
    process.exit(reportError(err));
  }
}

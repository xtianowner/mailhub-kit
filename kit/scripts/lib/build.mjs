// 依赖安装与前端构建。只用 node 直接调各包的 JS 入口，不经 shell，Windows 同样可用。
import fs from "node:fs";
import path from "node:path";

import { FRONTEND_DIR, KIT, StepError, WORKER_DIR, log, run } from "./common.mjs";

const NPM_DIRS = [KIT, WORKER_DIR, FRONTEND_DIR];

function npmCmd() {
  // npm 自带的 JS 入口，避开 Windows 上 npm.cmd 需要 shell 的问题。
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const alt = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const found = [cli, alt].find((p) => fs.existsSync(p));
  return found ? [process.execPath, [found]] : [process.platform === "win32" ? "npm.cmd" : "npm", []];
}

export function installDeps({ registry } = {}) {
  const [cmd, pre] = npmCmd();
  for (const dir of NPM_DIRS) {
    const marker = path.join(dir, "node_modules", ".package-lock.json");
    const lock = path.join(dir, "package-lock.json");
    if (fs.existsSync(marker) && fs.statSync(marker).mtimeMs >= fs.statSync(lock).mtimeMs) {
      log.ok(`依赖已就绪：${path.relative(path.dirname(KIT), dir) || "."}`);
      continue;
    }
    log.info(`安装依赖：${path.relative(path.dirname(KIT), dir)}（首次较慢）`);
    const args = [...pre, "ci", "--no-audit", "--no-fund"];
    if (registry) args.push(`--registry=${registry}`);
    const res = run(cmd, args, { cwd: dir, inherit: true });
    if (res.code !== 0) {
      throw new StepError(`npm ci 失败：${dir}`, {
        next: "国内网络可重跑并加镜像：node kit/scripts/setup.mjs deps --registry https://registry.npmmirror.com",
      });
    }
    log.ok(`依赖安装完成：${path.relative(path.dirname(KIT), dir)}`);
  }
}

/** 构建云端同款前端（本地版与云端版用同一份产物）。 */
export function buildFrontend() {
  const vite = path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) throw new StepError("前端依赖未安装", { next: "node kit/scripts/setup.mjs deps" });
  const out = path.join(FRONTEND_DIR, "dist-cloud");
  const res = run(process.execPath, [vite, "build", "--outDir", "dist-cloud", "--emptyOutDir"], {
    cwd: FRONTEND_DIR, env: { VITE_TARGET: "cloud" },
  });
  if (res.code !== 0) throw new StepError("前端构建失败\n" + (res.stderr || res.stdout).slice(-1500));

  // 三道硬检查，与原 build:cloud 一致：Workers 会校验 _redirects，写了回退规则会拒绝整个部署。
  if (fs.existsSync(path.join(out, "_redirects"))) throw new StepError("产物里出现 _redirects，会导致部署被拒");
  if (!fs.existsSync(path.join(out, "index.html"))) throw new StepError("产物缺 index.html");
  for (const f of fs.readdirSync(out, { recursive: true })) {
    if (path.basename(String(f)) === ".DS_Store") fs.rmSync(path.join(out, String(f)));
  }
  log.ok("前端已构建：modules/unified-mail/frontend/dist-cloud");
}

export const frontendBuilt = () => fs.existsSync(path.join(FRONTEND_DIR, "dist-cloud", "index.html"));

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("Windows launcher uses the recorded runtime, preserves spaced arguments and exit codes", { skip: process.platform !== "win32" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub runtime "));
  try {
    const runner = fileURLToPath(new URL("../scripts/node.ps1", import.meta.url));
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: process.execPath }));
    const script = path.join(tmp, "check args.mjs");
    fs.writeFileSync(script, "console.log(JSON.stringify({exe:process.execPath,args:process.argv.slice(2)}));process.exit(17);");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner, script, "space here", "literal$()"], {
      env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8",
    });
    assert.equal(r.status, 17, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { exe: process.execPath, args: ["space here", "literal$()"] });
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: path.join(tmp, "missing.exe") }));
    const missing = spawnSync("powershell.exe", ["-NoProfile", "-File", runner, script], {
      env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Saved Node runtime is missing/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 中文用户名（C:\Users\张三）下便携版 Node 的路径含非 ASCII；runtime.json 是无 BOM 的 UTF-8，
// Windows PowerShell 5.1 不指定编码会按 ANSI 读成乱码，三个启动器全部失效。
test("Windows launcher reads a recorded runtime path containing Chinese characters", { skip: process.platform !== "win32" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub 运行时 "));
  try {
    const runner = fileURLToPath(new URL("../scripts/node.ps1", import.meta.url));
    const node = path.join(tmp, "node.exe");
    try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: node }, null, 2) + "\n");
    const script = path.join(tmp, "check.mjs");
    fs.writeFileSync(script, "console.log(process.execPath);process.exit(17);");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner, script], {
      env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8",
    });
    assert.equal(r.status, 17, r.stderr);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

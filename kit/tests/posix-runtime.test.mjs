import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// macOS / Linux 的 start.sh / stop.sh 必须和 Windows 启动器一样，使用 configs 记录的 Node：
// 用户全局 Node 低于 22、搭建时用的是便携版或 nvm 装的版本时，PATH 里的 node 起不来 wrangler。
const posix = { skip: process.platform === "win32" };
const KIT = fileURLToPath(new URL("..", import.meta.url));
const runner = path.join(KIT, "scripts", "node.sh");
// 私有仓里根目录脚本在 kit/public-root/，开源仓里在仓库根。
const rootScript = (name) =>
  [path.join(KIT, "public-root", name), path.join(KIT, "..", name)].find((p) => fs.existsSync(p));

function fakeNode(dir) {
  const exe = path.join(dir, "fake node");
  fs.writeFileSync(exe, "#!/bin/sh\nfor a in \"$@\"; do printf '[%s]\\n' \"$a\"; done\nexit 17\n", { mode: 0o755 });
  return exe;
}

test("node.sh 使用记录的 Node，参数与退出码原样转发", posix, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub runtime "));
  try {
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: fakeNode(tmp) }, null, 2));
    const r = spawnSync("sh", [runner, "space here", "literal$()"], { env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8" });
    assert.equal(r.status, 17, r.stderr);
    assert.equal(r.stdout, "[space here]\n[literal$()]\n");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("node.sh：记录的 Node 不存在时明确失败，不悄悄换用 PATH 里的 node", posix, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-runtime-"));
  try {
    fs.writeFileSync(path.join(tmp, "runtime.json"), JSON.stringify({ execPath: path.join(tmp, "missing-node") }));
    const r = spawnSync("sh", [runner, "-v"], { env: { ...process.env, MAILHUB_STATE_DIR: tmp }, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Saved Node runtime is missing/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("node.sh：还没有记录时用 PATH 里的 node", posix, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-runtime-"));
  try {
    const env = { ...process.env, MAILHUB_STATE_DIR: tmp, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
    const r = spawnSync("sh", [runner, "-e", "process.exit(9)"], { env, encoding: "utf8" });
    assert.equal(r.status, 9, r.stderr);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("start.sh / stop.sh 经 node.sh 启动，用的是记录的 Node", posix, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub root "));
  try {
    fs.mkdirSync(path.join(tmp, "kit", "scripts"), { recursive: true });
    fs.copyFileSync(runner, path.join(tmp, "kit", "scripts", "node.sh"));
    const state = path.join(tmp, ".mailhub");
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, "runtime.json"), JSON.stringify({ execPath: fakeNode(tmp) }));
    for (const [name, args] of [["start.sh", "[kit/scripts/local.mjs]\n[start]\n[--open]\n"], ["stop.sh", "[kit/scripts/local.mjs]\n[stop]\n"]]) {
      fs.copyFileSync(rootScript(name), path.join(tmp, name));
      const env = { ...process.env };
      delete env.MAILHUB_STATE_DIR;
      const r = spawnSync("sh", [path.join(tmp, name)], { env, encoding: "utf8" });
      assert.equal(r.status, 17, `${name}: ${r.stderr}`);
      assert.equal(r.stdout, args, name);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

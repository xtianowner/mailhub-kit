// 网页形象（brand）的 init 行为：新安装默认作者形象；老配置升级不悄悄换形象、不清记录；只换形象只重做网页相关三步。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = path.join(KIT, "scripts", "setup.mjs");
const BASE = ["--domain", "demo.test", "--web-host", "mail.demo.test", "--login-user", "me@example.org"];

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-brand-"));
  const setup = (...args) => spawnSync(process.execPath, [SETUP, ...args], {
    env: { ...process.env, MAILHUB_STATE_DIR: dir }, encoding: "utf8",
  });
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const write = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 2));
  return { dir, setup, read, write };
}

const ALL_DONE = Object.fromEntries(["deps", "login", "zone", "d1", "configs", "deploy-api", "build", "deploy-web", "local", "verify"]
  .map((k) => [k, "2026-10-01T00:00:00.000Z"]));

test("新安装不传 --brand：默认作者形象 xtian", () => {
  const s = sandbox();
  assert.equal(s.setup("init", ...BASE).status, 0);
  assert.equal(s.read("config.json").brand, "xtian");
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test("老配置（没有 brand）重跑 init：保持通用插画，完成记录与用户确认都不动", () => {
  const s = sandbox();
  s.write("config.json", { domain: "demo.test", web_host: "mail.demo.test", api_host: "api-mail.demo.test",
    login_user: "me@example.org", attachments: false, prefix: "mailhub" });
  s.write("state.json", { done: ALL_DONE, user_confirmed: "2026-10-01T00:00:00.000Z" });
  assert.equal(s.setup("init").status, 0);
  assert.equal(s.read("config.json").brand, "default");
  const st = s.read("state.json");
  assert.deepEqual(st.done, ALL_DONE);
  assert.equal(st.user_confirmed, "2026-10-01T00:00:00.000Z");
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test("只换形象：只清 build / deploy-web / local，其余记录与用户确认保留", () => {
  const s = sandbox();
  assert.equal(s.setup("init", ...BASE, "--brand", "default").status, 0);
  s.write("state.json", { done: ALL_DONE, user_confirmed: "2026-10-01T00:00:00.000Z" });
  const r = s.setup("init", "--brand", "xtian");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /形象改为 xtian/);
  const st = s.read("state.json");
  for (const k of ["build", "deploy-web", "local"]) assert.equal(st.done[k], undefined, k);
  for (const k of ["deps", "login", "zone", "d1", "configs", "deploy-api", "verify"]) assert.ok(st.done[k], k);
  assert.equal(st.user_confirmed, "2026-10-01T00:00:00.000Z");
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test("换形象的同时改了别的配置：照旧清空完成记录", () => {
  const s = sandbox();
  assert.equal(s.setup("init", ...BASE).status, 0);
  s.write("state.json", { done: ALL_DONE, user_confirmed: "2026-10-01T00:00:00.000Z" });
  assert.equal(s.setup("init", "--brand", "default", "--attachments").status, 0);
  const st = s.read("state.json");
  assert.deepEqual(Object.keys(st.done).sort(), ["deps", "login"]);
  assert.equal(st.user_confirmed, null);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test("不认识的形象名被拒绝", () => {
  const s = sandbox();
  const r = s.setup("init", ...BASE, "--brand", "mine");
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /brand/);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

// CI 与 README「开发者自测」会不 init 直接 build：缺配置时不能报错，按新安装默认值构建（2026-10-06 CI 曾因此失败）。
test("构建选形象：还没 init → xtian；老配置 → default；配置了 custom → custom", () => {
  const pick = (dir) => spawnSync(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(path.join(KIT, "scripts", "lib", "build.mjs"))}); console.log(m.brandForBuild());`],
  { env: { ...process.env, MAILHUB_STATE_DIR: dir }, encoding: "utf8" });
  const s = sandbox();
  let r = pick(s.dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "xtian");
  s.write("config.json", { domain: "demo.test", web_host: "mail.demo.test", login_user: "me@example.org" });
  assert.equal(pick(s.dir).stdout.trim(), "default");
  s.write("config.json", { domain: "demo.test", web_host: "mail.demo.test", login_user: "me@example.org", brand: "custom" });
  assert.equal(pick(s.dir).stdout.trim(), "custom");
  fs.rmSync(s.dir, { recursive: true, force: true });
});

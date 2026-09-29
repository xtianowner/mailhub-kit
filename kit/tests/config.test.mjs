// 安装器的纯逻辑：配置校验、资源命名、生成的 wrangler 配置、密钥不外露。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MAILHUB_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mailhub-unit-"));
const { validateConfig, wranglerConfigs, names, passwordProblem } = await import("../scripts/lib/config.mjs");
const common = await import("../scripts/lib/common.mjs");
test.after(() => fs.rmSync(process.env.MAILHUB_STATE_DIR, { recursive: true, force: true }));

const base = { domain: "Demo.Test", web_host: "mail.demo.test", login_user: " me@example.org " };

test("规范化：小写、去空白；没给数据接口地址时派生 api-mail.<域名>", () => {
  const cfg = validateConfig(base);
  assert.equal(cfg.domain, "demo.test");
  assert.equal(cfg.api_host, "api-mail.demo.test");
  assert.equal(cfg.login_user, "me@example.org");
  assert.equal(cfg.attachments, false);
  assert.equal(cfg.prefix, "mailhub");
});

test("地址必须是该域名的子域名，且不能用根域本身", () => {
  for (const bad of ["demo.test", "mail.other.test", "evil-demo.test", "mail.demo.test.evil.net"]) {
    assert.throws(() => validateConfig({ ...base, web_host: bad }), /子域名|不是合法/, bad);
  }
  assert.throws(() => validateConfig({ ...base, api_host: "mail.demo.test" }), /不能相同/);
});

test("模板值与空值被拒绝", () => {
  assert.throws(() => validateConfig({ ...base, domain: "example.com", web_host: "mail.example.com" }), /模板/);
  assert.throws(() => validateConfig({ ...base, login_user: "  " }), /不能为空/);
  assert.throws(() => validateConfig({ ...base, prefix: "Bad_Prefix" }), /prefix/);
});

test("资源名由前缀派生，可在同一账号并存多套", () => {
  assert.deepEqual(names(validateConfig({ ...base, prefix: "mh2" })),
    { db: "mh2-db", bucket: "mh2-attachments", inbox: "mh2-inbox", api: "mh2-api", web: "mh2-web" });
});

test("生成的配置：自定义域名、不开 workers.dev、不含任何密钥", () => {
  const cfg = validateConfig(base);
  const c = wranglerConfigs(cfg, { databaseId: "db-uuid" });
  assert.deepEqual(c.api.routes, [{ pattern: "api-mail.demo.test", custom_domain: true }]);
  assert.deepEqual(c.web.routes, [{ pattern: "mail.demo.test", custom_domain: true }]);
  for (const w of Object.values(c)) assert.equal(w.workers_dev, false, "workers.dev 在国内被封，且不需要第二个入口");
  assert.equal(c.web.vars.CFMAIL_BASE_URL, "https://api-mail.demo.test");
  assert.equal(c.api.vars.CORS_ORIGINS, "https://mail.demo.test");
  const text = JSON.stringify(c);
  for (const k of ["ADMIN_TOKEN", "SITE_PASSWORD", "APP_PASSWORD", "SESSION_SECRET"]) {
    assert.ok(!text.includes(`"${k}"`), `${k} 不能出现在配置里`);
  }
});

test("本地版配置没有 routes（否则 wrangler dev 会改写主机名，免登录失效）", () => {
  const c = wranglerConfigs(validateConfig(base), { databaseId: "x" });
  assert.equal(c["web-local"].routes, undefined);
  assert.deepEqual(c["web-local"].assets, c.web.assets);
});

test("附件开关决定是否绑定 R2", () => {
  const off = wranglerConfigs(validateConfig(base), { databaseId: "x" });
  assert.equal(off.inbox.r2_buckets, undefined);
  const on = wranglerConfigs(validateConfig({ ...base, attachments: true }), { databaseId: "x" });
  assert.deepEqual(on.inbox.r2_buckets, [{ binding: "ATTACHMENTS", bucket_name: "mailhub-attachments" }]);
});

test(".dev.vars：往返一致，权限 600", () => {
  const file = path.join(process.env.MAILHUB_STATE_DIR, "t.dev.vars");
  common.writeDevVars({ A: "1", B: "x y" }, file);
  assert.deepEqual(common.readDevVars(file), { A: "1", B: "x y" });
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("子进程输出里的密钥会被抹掉", () => {
  const secret = `scrub-me-${process.pid}-${Date.now()}`; // 运行时生成，避免仓库里出现凭据样式的字面量
  const res = common.run(process.execPath, ["-e", `console.log("token=${secret}"); console.error("${secret}")`],
    { secretValues: [secret] });
  assert.ok(!res.stdout.includes(secret) && !res.stderr.includes(secret));
  assert.match(res.stdout, /token=\*\*\*/);
});

test("密钥经 stdin 传递，不出现在参数里", () => {
  const res = common.run(process.execPath, ["-e", "process.stdin.on('data', d => process.stdout.write(String(d.length)))"],
    { input: "abcdef" });
  assert.equal(res.stdout, "6");
});

test("登录密码：太短、首尾空格被拒；中间空格与中文可以", () => {
  assert.match(passwordProblem("short"), /8 位/);
  assert.match(passwordProblem("password123 "), /空格/);
  assert.match(passwordProblem(" password123"), /空格/);
  assert.equal(passwordProblem("        "), "开头和结尾不能有空格");
  assert.equal(passwordProblem("pass word 中文123"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createTestD1 } from "../../../../kit/tests/helpers/sqlite-d1.mjs";
import { checkLoginRateLimit } from "../src/login-rate-limit.mjs";
import gateway from "../src/index.js";
import { randomUUID } from "node:crypto";

// 测试值运行时生成，不在源码里写像凭据的字面量（发布前的密钥扫描会拦）。
const SECRET = randomUUID();
const PASSWORD = randomUUID();

function envFor(t) {
  return { DB: createTestD1(t), SESSION_SECRET: SECRET, APP_USER: "owner@example.com",
    APP_PASSWORD: PASSWORD, CFMAIL_ADMIN_TOKEN: "admin", CFMAIL_SITE_PASSWORD: "site" };
}
const req = (ip = "192.0.2.1", extra = {}) => new Request("https://mail.example.com/auth/login", {
  method: "POST", headers: { "CF-Connecting-IP": ip, "content-type": "application/json", ...extra },
  body: JSON.stringify({ username: "OWNER@example.com", password: PASSWORD }),
});

test("concurrent requests across instances share five attempts, then recover without extending lockout", async (t) => {
  const env = envFor(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => checkLoginRateLimit(req(), { ...env }, 1000)));
  assert.equal(results.filter((r) => r === 0).length, 5);
  assert.equal(results.filter((r) => r === 300).length, 15);
  assert.equal(await checkLoginRateLimit(req(), env, 1299), 1);
  assert.equal(await checkLoginRateLimit(req(), env, 1300), 0);
  assert.equal(await checkLoginRateLimit(req("192.0.2.2"), env, 1300), 0);
  assert.ok(!JSON.stringify(env.DB.sqlite.prepare("SELECT * FROM login_rate_limits").all()).includes("192.0.2."));
});

test("rotating IPs cannot exceed the shared account budget", async (t) => {
  const env = envFor(t);
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => checkLoginRateLimit(req(`192.0.2.${i}`), env, 1000)));
  assert.equal(results.filter((r) => r === 0).length, 30);
  assert.equal(results.filter((r) => r === 60).length, 10);
  assert.equal(await checkLoginRateLimit(req("198.51.100.1"), env, 1060), 0);
});

test("forwarded headers cannot rotate client identity and missing IP uses a shared bucket", async (t) => {
  const env = envFor(t);
  for (let i = 0; i < 5; i++) assert.equal(await checkLoginRateLimit(req(), env, 1000), 0);
  assert.equal(await checkLoginRateLimit(req(undefined, { "X-Forwarded-For": "203.0.113.1" }), env, 1000), 300);
  const missing = req();
  missing.headers.delete("CF-Connecting-IP");
  for (let i = 0; i < 5; i++) assert.equal(await checkLoginRateLimit(missing, env, 1000), 0);
  assert.equal(await checkLoginRateLimit(missing, env, 1000), 300);
});

test("gateway returns 429 before credential checking, with Retry-After and no cookie", async (t) => {
  const env = envFor(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await gateway.fetch(req(), env)).status, 200);
  }
  const blocked = await gateway.fetch(req(), env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("set-cookie"), null);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await blocked.json()).code, "LOGIN_RATE_LIMITED");
});

test("missing or unavailable shared protection fails closed", async (t) => {
  const env = envFor(t);
  for (const DB of [undefined, { prepare() { throw new Error("D1 unavailable"); } }]) {
    const result = await gateway.fetch(req(), { ...env, DB });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("set-cookie"), null);
  }
});

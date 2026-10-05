// 网关 Worker 的鉴权边界：线上必须登录；本地免登录只在「开关 + 回环地址」同时成立时放行。
import test from "node:test";
import assert from "node:assert/strict";

import gateway from "../src/index.js";
import { createTestD1 } from "../../../../kit/tests/helpers/sqlite-d1.mjs";

const CFMAIL = { CFMAIL_ADMIN_TOKEN: "admin-test", CFMAIL_SITE_PASSWORD: "site-test",
                 CFMAIL_BASE_URL: "https://api-mail.example.com" };
const LOGIN = { APP_USER: "Me@Example.com", APP_PASSWORD: "pw-Test 1", SESSION_SECRET: "s".repeat(64) };
const ASSETS = { fetch: async () => new Response("<html>spa</html>", { status: 200 }) };

function withUpstream(fn) {
  return async (t) => {
    const seen = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true, domains: ["example.com"] }),
                          { status: 200, headers: { "content-type": "application/json" } });
    };
    try { await fn(seen, t); } finally { globalThis.fetch = original; }
  };
}

const call = (url, env, init) => gateway.fetch(new Request(url, init), { ASSETS, ...env });

test("线上：未登录访问数据接口一律 401，不打上游", withUpstream(async (seen) => {
  const res = await call("https://mail.example.com/admin/domains", { ...CFMAIL, ...LOGIN });
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
}));

test("线上：误设 LOCAL_NO_LOGIN 也不放行（主机名不是回环地址）", withUpstream(async (seen) => {
  const env = { ...CFMAIL, ...LOGIN, LOCAL_NO_LOGIN: "1" };
  const res = await call("https://mail.example.com/admin/domains", env);
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
  const status = await (await call("https://mail.example.com/auth/status", env)).json();
  assert.equal(status.authed, false);
  assert.equal(status.local, false);
}));

test("线上：缺登录三件套时 /auth/* 明确报未配置", async () => {
  const res = await call("https://mail.example.com/auth/status", { ...CFMAIL });
  assert.equal(res.status, 503);
});

test("本地：开关 + 127.0.0.1 → 免登录直通，并由服务端注入密钥", withUpstream(async (seen) => {
  const env = { ...CFMAIL, LOCAL_NO_LOGIN: "1" };
  const status = await (await call("http://127.0.0.1:8787/auth/status", env)).json();
  assert.deepEqual(status, { authed: true, configured: true, local: true });

  const res = await call("http://127.0.0.1:8787/admin/domains", env);
  assert.equal(res.status, 200);
  assert.equal(seen[0].url, "https://api-mail.example.com/admin/domains");
  assert.equal(seen[0].headers.get("x-admin-auth"), "admin-test");

  await call("http://localhost:8787/api/mailboxes/code?address=a@example.com", env);
  assert.equal(new URL(seen[1].url).searchParams.get("password"), "site-test");
}));

test("本地：没开开关时 127.0.0.1 也要登录", withUpstream(async (seen) => {
  const res = await call("http://127.0.0.1:8787/admin/domains", { ...CFMAIL, ...LOGIN });
  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
}));

test("本地：开关打开但缺 CFMAIL 密钥时报未配置", async () => {
  const res = await call("http://127.0.0.1:8787/auth/status", { LOCAL_NO_LOGIN: "1" });
  assert.equal(res.status, 503);
});

test("线上登录：用户名忽略大小写，密码区分大小写，登录后可访问数据", withUpstream(async (seen, t) => {
  const env = { ...CFMAIL, ...LOGIN, DB: createTestD1(t) };
  const bad = await call("https://mail.example.com/auth/login", env, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "me@example.com", password: "PW-test 1" }),
  });
  assert.equal(bad.status, 401);

  const good = await call("https://mail.example.com/auth/login", env, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: " ME@example.com ", password: "pw-Test 1" }),
  });
  assert.equal(good.status, 200);
  const cookie = good.headers.get("set-cookie").split(";")[0];

  const res = await call("https://mail.example.com/admin/domains", env, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);

  for (const headers of [
    { Origin: "https://evil.example.com", "Sec-Fetch-Site": "same-site" },
    { Origin: "https://evil.example.net" },
  ]) {
    const rejected = await call("https://mail.example.com/admin/settings/receiving", env, {
      method: "POST", headers: { Cookie: cookie, ...headers }, body: '{"receive_mode":"auto"}',
    });
    assert.equal(rejected.status, 403, "another site cannot change receiving policy using a session");
  }
  assert.equal(seen.length, 1);
  assert.equal((await call("https://mail.example.com/admin/settings/receiving", env, {
    method: "POST", headers: { Cookie: cookie, Origin: "https://mail.example.com", "Sec-Fetch-Site": "same-origin" },
    body: '{"receive_mode":"registered"}',
  })).status, 200);
}));

test("非数据路径交给静态资源", async () => {
  const res = await call("https://mail.example.com/domain", { ...CFMAIL, ...LOGIN });
  assert.equal(await res.text(), "<html>spa</html>");
});

test("本地：跨站网页提交的写请求被拒绝（CSRF），同源页面与命令行客户端放行", withUpstream(async (seen) => {
  const env = { ...CFMAIL, LOCAL_NO_LOGIN: "1" };
  const post = (headers) => call("http://127.0.0.1:8790/admin/new_address", env, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: "name=x",
  });
  assert.equal((await post({ Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post({ Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "same-site" })).status, 403);
  assert.equal((await post({ Origin: "http://127.0.0.1:9999" })).status, 403, "别的本机端口也算跨站");
  assert.equal(seen.length, 0, "被拒的请求不能打到上游");
  assert.equal((await post({ Origin: "http://127.0.0.1:8790", "Sec-Fetch-Site": "same-origin" })).status, 200);
  assert.equal((await post({})).status, 200, "curl 等不带 Origin 的客户端放行");
  assert.equal(seen.length, 2);
}));

// 邮件正文 iframe 为了「适应宽度」开了 allow-same-origin。Safari / Firefox 不支持 credentialless，
// 恶意邮件里指向本站接口的 <img> 在点「显示图片」后会带登录 Cookie，读不到数据，但会消耗 D1 读取额度。
// 浏览器用 Sec-Fetch-Dest 标明请求用途：数据接口只接受 fetch / XHR（empty）和不带该头的命令行客户端。
test("数据接口拒绝以图片、页面等名义发来的浏览器请求，不打上游", withUpstream(async (seen) => {
  const env = { ...CFMAIL, LOCAL_NO_LOGIN: "1" };
  for (const dest of ["image", "document", "iframe", "script", "style"]) {
    const res = await call("http://127.0.0.1:8787/admin/mailboxes", env, { headers: { "Sec-Fetch-Dest": dest } });
    assert.equal(res.status, 403, dest);
  }
  assert.equal(seen.length, 0, "被拒绝的请求不能转发给 mail-api");
  const ok = await call("http://127.0.0.1:8787/admin/mailboxes", env, { headers: { "Sec-Fetch-Dest": "empty" } });
  assert.equal(ok.status, 200);
  const cli = await call("http://127.0.0.1:8787/admin/mailboxes", env);
  assert.equal(cli.status, 200);
}));

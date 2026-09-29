// mail-api 的 fetch 入口测试。
//
// 为什么必须有：这轮为了加 CORS 把 `export default { async fetch(){...} }` 拆成
// 「fetch 只做预检放行 + 统一加头，handleRequest 负责路由」，改结构时**连错两次闭合**。
// node --check 只验语法，验不出「对象结构错了但恰好能 parse」这类问题，
// 更验不出 handleRequest 根本没被调到。所以这里真调用 fetch 走一遍。
import test from "node:test";
import assert from "node:assert/strict";

const DASHBOARD = new URL("../deploy/cloudflare-dashboard/mail-api-dashboard.js", import.meta.url);

const ADMIN = "admin-token-xyz";
const SITE = "site-pass-abc";

function makeEnv(extra = {}) {
  const updates = extra.__updates || [];
  return {
    ADMIN_TOKEN: ADMIN,
    SITE_PASSWORD: SITE,
    ...extra,
    DB: {
      prepare(sql) {
        return {
          bind() { return this },
          async first() {
            if (sql.includes("COUNT(*) as count FROM domains")) return { count: 3 };
            if (sql.includes("COUNT(*) AS n FROM mailboxes")) return { n: 2 };
            if (sql.includes("sending_enabled = 1")) return { domain: "example.net" };
            if (sql.includes("FROM mailboxes")) {
              return { id: "mbx_send", email: "hello@example.net" };
            }
            return null;
          },
          async all() {
            if (sql.includes("sending_enabled = 1")) {
              return { results: [{ domain: "example.net" }] };
            }
            if (sql.includes("FROM mailboxes")) {
              return { results: [{
                id: "mbx_send",
                email: "hello@example.net",
                label: "主邮箱",
                group_name: "业务",
              }] };
            }
            if (sql.includes("FROM domains")) {
              return { results: [{ domain: "example.com", enabled: 1 }] };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes("UPDATE mailboxes SET label")) updates.push(sql);
            return { success: true };
          },
        };
      },
    },
  };
}

const req = (path, init = {}) =>
  new Request(`https://mail-api.example.com${path}`, init);

const load = async () => (await import(DASHBOARD)).default;

test("OPTIONS 预检直接放行（不带鉴权头也必须过）", async () => {
  const w = await load();
  const res = await w.fetch(req("/admin/mailboxes", {
    method: "OPTIONS",
    headers: { Origin: "https://mail.example.com", "Access-Control-Request-Method": "GET" },
  }), makeEnv(), {});
  assert.equal(res.status, 204, "预检必须 204 —— 之前是 404，浏览器连真请求都发不出去");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://mail.example.com");
  assert.match(res.headers.get("access-control-allow-headers") || "", /x-admin-auth/);
});

test("普通请求照常工作，且带上 CORS 头（证明 handleRequest 真被调到了）", async () => {
  const w = await load();
  const res = await w.fetch(req("/", {
    headers: { Origin: "https://mail.example.com" },
  }), makeEnv(), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://mail.example.com");
  const body = await res.json();
  assert.equal(body.ok, true, "路由没被调到的话这里会是 undefined");
});

test("没有 Origin 时不加 CORS 头（本机/服务端调用不受影响）", async () => {
  const w = await load();
  const res = await w.fetch(req("/"), makeEnv(), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS 放开不等于免鉴权：无 token 仍然 401", async () => {
  const w = await load();
  const res = await w.fetch(req("/admin/mailboxes", {
    headers: { Origin: "https://mail.example.com" },
  }), makeEnv(), {});
  assert.equal(res.status, 401, "密钥才是真正的门禁");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://mail.example.com",
    "401 也要带 CORS 头，否则浏览器读不到状态码、只会报一个含糊的网络错误");
});

test("带正确 token 能拿到数据", async () => {
  const w = await load();
  const res = await w.fetch(req("/admin/domains", {
    headers: { Origin: "https://mail.example.com", "x-admin-auth": ADMIN },
  }), makeEnv(), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.domains, ["example.com"]);
});

test("信箱列表返回备注/分组，编辑端点只更新已存在的真实信箱", async () => {
  const w = await load();
  const updates = [];
  const env = makeEnv({ __updates: updates });

  const listed = await w.fetch(req("/admin/mailboxes?q=业务", {
    headers: { "x-admin-auth": ADMIN },
  }), env, {});
  assert.equal(listed.status, 200);
  const listBody = await listed.json();
  assert.equal(listBody.results[0].label, "主邮箱");
  assert.equal(listBody.results[0].group, "业务");

  const edited = await w.fetch(req("/admin/mailboxes/meta", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-auth": ADMIN },
    body: JSON.stringify({
      email: "hello@example.net",
      label: "客服邮箱",
      group: "支持",
    }),
  }), env, {});
  assert.equal(edited.status, 200);
  const editBody = await edited.json();
  assert.deepEqual(editBody.mailbox, {
    email: "hello@example.net",
    label: "客服邮箱",
    group: "支持",
  });
  assert.equal(updates.length, 1);
});

test("发件状态需要 admin 鉴权，并同时检查 binding 与启用域名", async () => {
  const w = await load();
  const env = makeEnv({ EMAIL: { send: async () => ({ messageId: "unused" }) } });
  const res = await w.fetch(req("/admin/sending/status", {
    headers: { "x-admin-auth": ADMIN },
  }), env, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, true);
  assert.deepEqual(body.domains, ["example.net"]);
  assert.deepEqual(body.from_addresses, ["hello@example.net"]);
});

test("发件端点把 UTF-8 正文交给 Email binding", async () => {
  const w = await load();
  const sent = [];
  const env = makeEnv({
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: "provider-001" };
      },
    },
  });
  const res = await w.fetch(req("/admin/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-auth": ADMIN },
    body: JSON.stringify({
      from: "hello@example.net",
      to: "reader@example.com",
      subject: "中文主题",
      text: "你好，世界",
    }),
  }), env, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message.status, "accepted");
  assert.equal(sent[0].text, "你好，世界");
});

test("CORS_ORIGINS 设了就只放行名单内的来源", async () => {
  const w = await load();
  const env = makeEnv({ CORS_ORIGINS: "https://mail.example.com" });

  const good = await w.fetch(req("/", { headers: { Origin: "https://mail.example.com" } }), env, {});
  assert.equal(good.headers.get("access-control-allow-origin"), "https://mail.example.com");

  const bad = await w.fetch(req("/", { headers: { Origin: "https://evil.example" } }), env, {});
  assert.equal(bad.headers.get("access-control-allow-origin"), null, "名单外的来源不给 CORS 头");
  assert.equal(bad.status, 200, "但请求本身照常处理（服务端调用不受 Origin 影响）");
});

test("未知路径仍回 404 且不炸", async () => {
  const w = await load();
  const res = await w.fetch(req("/no-such-path"), makeEnv(), {});
  assert.equal(res.status, 404);
});

// GET /admin/messages/recent 的 group 过滤（统一总览「按分组筛选最近邮件」）。
//
// 同时跑源码和直贴版：直贴版才是真正粘到 Cloudflare 的那份，
// 源码改了却忘了 `npm run build:dashboard` 时，这里会直接红。
import test from "node:test";
import assert from "node:assert/strict";

const TARGETS = {
  src: new URL("../src/mail-api.js", import.meta.url),
  dashboard: new URL("../deploy/cloudflare-dashboard/mail-api-dashboard.js", import.meta.url),
};

const ADMIN = "admin-token-xyz";

// 假 D1：记下 recent 查询的 SQL 与绑定值，回一行固定数据。
function makeEnv() {
  const calls = [];
  return {
    calls,
    ADMIN_TOKEN: ADMIN,
    SITE_PASSWORD: "site-pass-abc",
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async first() { return null; },
          async all() {
            if (sql.includes("FROM messages m")) {
              calls.push({ sql, args });
              return { results: [{
                id: "msg_1", mailbox_id: "mbx_work", mail_from: "noreply@openai.com",
                subject: "OpenAI code", text_body: "Your code is 123456", html_body: "",
                code: "123456", link: null, received_at: "2026-10-05T01:00:00Z",
                mailbox_email: "work@example.net",
              }] };
            }
            return { results: [] };
          },
          async run() { return { success: true }; },
        };
      },
    },
  };
}

const recent = async (target, query) => {
  const worker = (await import(TARGETS[target])).default;
  const env = makeEnv();
  const res = await worker.fetch(new Request(
    `https://mail-api.example.com/admin/messages/recent${query}`,
    { headers: { "x-admin-auth": ADMIN } },
  ), env, {});
  return { res, body: await res.json(), calls: env.calls };
};

for (const target of Object.keys(TARGETS)) {
  test(`[${target}] group 去掉首尾空白后按 mb.group_name 精确匹配，且走参数绑定`, async () => {
    const { res, body, calls } = await recent(target, `?group=${encodeURIComponent("  工作 ")}`);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.results[0].mailbox_email, "work@example.net");
    assert.equal(calls.length, 1);
    const { sql, args } = calls[0];
    assert.match(sql, /WHERE[\s\S]*mb\.group_name = \?/, "必须按信箱分组精确过滤");
    assert.doesNotMatch(sql, /LIKE \?[\s\S]*group_name|group_name[\s\S]*LIKE/, "分组是精确匹配，不是模糊搜索");
    assert.ok(!sql.includes("工作"), "分组名只能走绑定参数，不能拼进 SQL");
    assert.deepEqual(args, ["工作", 50, 0]);
  });

  test(`[${target}] group 与 q / only_codes / limit / offset 可以组合`, async () => {
    const { res, calls } = await recent(target,
      `?group=${encodeURIComponent("工作")}&q=OpenAI&only_codes=true&limit=10&offset=5`);
    assert.equal(res.status, 200);
    const { sql, args } = calls[0];
    assert.match(sql, /m\.code IS NOT NULL/);
    assert.match(sql, /lower\(m\.subject\) LIKE \?/);
    assert.match(sql, /mb\.group_name = \?/);
    // 绑定值顺序必须与 SQL 占位符顺序一致：q×3 → group → limit → offset
    assert.deepEqual(args, ["%openai%", "%openai%", "%openai%", "工作", 10, 5]);
  });

  test(`[${target}] group 缺省、为空或全空白时不加分组条件（行为与改动前一致）`, async () => {
    const baseline = (await recent(target, "")).calls[0];
    assert.doesNotMatch(baseline.sql, /group_name/);
    for (const query of ["?group=", `?group=${encodeURIComponent("   ")}`]) {
      const { res, calls } = await recent(target, query);
      assert.equal(res.status, 200);
      assert.equal(calls[0].sql, baseline.sql, `${query} 不应改变 SQL`);
      assert.deepEqual(calls[0].args, [50, 0]);
    }
  });
}

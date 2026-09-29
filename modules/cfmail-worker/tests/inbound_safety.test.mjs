// 收信安全测试：**任何单点故障都不能让一封信凭空消失**。
//
// 测的是 deploy/cloudflare-dashboard/mail-inbox-dashboard.js —— 真正跑在 Cloudflare 上
// 的那一份，不是 src。Email Worker 的特殊性在于：handler 正常返回 = 告诉 CF「已投递」，
// 发件方再也不会重投。所以「静默失败」在这里等于永久丢信。
import test from "node:test";
import assert from "node:assert/strict";

const DASHBOARD = new URL("../deploy/cloudflare-dashboard/mail-inbox-dashboard.js", import.meta.url);

const RAW_MAIL = [
  "From: OpenAI <noreply@tm.openai.com>",
  "To: someone@example.com",
  "Subject: Your verification code",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Your code is 123456.",
  "",
].join("\r\n");

function makeMessage(to, { rawThrows = false } = {}) {
  return {
    from: "noreply@tm.openai.com",
    to,
    headers: new Map([["subject", "Your verification code"]]),
    get raw() {
      if (rawThrows) throw new Error("raw stream exploded");
      return new TextEncoder().encode(RAW_MAIL).buffer;
    },
  };
}

/**
 * D1 桩。failures 用来精准注入故障：
 *   readMailbox   —— 查信箱时抛
 *   domains       —— 查域名表时抛
 *   insertMailbox —— 建信箱时抛
 *   insertMessage —— 落库时抛（'all' 全抛 / 'full' 只抛完整那次）
 */
function makeEnv({ mailboxes = [], domains = ["example.com"], fail = {} } = {}) {
  const messages = [];
  let msgInsertCount = 0;
  return {
    messages, mailboxes,
    get msgInsertAttempts() { return msgInsertCount },
    DB: {
      prepare(sql) {
        return {
          _b: [],
          bind(...a) { this._b = a; return this },
          async first() {
            if (sql.includes("FROM mailboxes")) {
              if (fail.readMailbox) throw new Error("D1 read hiccup");
              const e = String(this._b[0] || "").toLowerCase();
              return mailboxes.find((m) => m.email.toLowerCase() === e) || null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM domains")) {
              if (fail.domains) throw new Error("D1 domains query failed");
              return { results: domains.map((d) => ({ domain: d })) };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes("INTO mailboxes")) {
              if (fail.insertMailbox) throw new Error("UNIQUE constraint failed");
              const [id, email, domain, subdomain, local_part, fingerprint, status, created_at, expires_at] = this._b;
              mailboxes.push({ id, email, domain, subdomain, local_part, fingerprint, status, created_at, expires_at });
              return { success: true };
            }
            if (sql.includes("INTO messages")) {
              msgInsertCount += 1;
              if (fail.insertMessage === "all") throw new Error("messages insert always fails");
              if (fail.insertMessage === "full" && msgInsertCount === 1) throw new Error("body too large");
              const [id, mailbox_id, mail_from, subject, text_body, html_body, code, link, received_at] = this._b;
              messages.push({ id, mailbox_id, mail_from, subject, text_body, html_body, code, link, received_at });
              return { success: true };
            }
            return { success: true };
          },
        };
      },
    },
  };
}

async function run(worker, message, env) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.map(String).join(" "));
  let thrown = null;
  try {
    await worker.email(message, env);
  } catch (e) {
    thrown = e;
  } finally {
    console.log = orig;
  }
  return { logs, thrown };
}

const load = async () => (await import(DASHBOARD)).default;

test("正常路径：信完整落库 + 自动建信箱 + 无任何降级", async () => {
  const env = makeEnv();
  const { thrown, logs } = await run(await load(), makeMessage("new@example.com"), env);
  assert.equal(thrown, null);
  // ⚠️ 关键断言：正常路径下**一条降级日志都不该有**。
  // 加固后每步都有 try/catch 兜底，未定义符号之类的错误会被静默降级掉 ——
  // 曾经就因此让 buildStoredMessage 缺失、验证码全变 null 却没人发现。
  for (const bad of ["mail_parse_failed", "ensure_mailbox_threw", "mail_stored_degraded",
                     "mailbox_auto_create_failed", "mail_store_failed"]) {
    assert.ok(!logs.some((l) => l.includes(bad)), `正常路径不该出现降级日志 ${bad}：${logs.join(" | ")}`);
  }
  assert.ok(logs.some((l) => l.includes('"degraded":false')), "应当报告未降级");
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].code, "123456");
  assert.equal(env.mailboxes.length, 1);
  assert.equal(env.mailboxes[0].fingerprint, "auto-inbound");
  assert.ok(env.mailboxes[0].expires_at, "expires_at 要有值，不写 NULL（可能有 NOT NULL 约束）");
});

test("查信箱的 D1 读失败 → 信照样落库（不再丢信）", async () => {
  // 这正是加固前会丢信的场景：ensureMailboxId 第一行的 SELECT 抛出 → handler 中止
  const env = makeEnv({ fail: { readMailbox: true } });
  const { thrown } = await run(await load(), makeMessage("x@example.com"), env);
  assert.equal(thrown, null, "绝不能抛给 CF（信其实还能存）");
  assert.equal(env.messages.length, 1, "信必须落库");
  assert.equal(env.messages[0].mailbox_id, "inbox_test", "降级到兜底桶，但信没丢");
});

test("域名表查询失败 → 信照样落库", async () => {
  const env = makeEnv({ fail: { domains: true } });
  const { thrown } = await run(await load(), makeMessage("x@example.com"), env);
  assert.equal(thrown, null);
  assert.equal(env.messages.length, 1);
});

test("建信箱失败 → 信照样落库到兜底桶", async () => {
  const env = makeEnv({ fail: { insertMailbox: true } });
  const { thrown } = await run(await load(), makeMessage("x@example.com"), env);
  assert.equal(thrown, null);
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].mailbox_id, "inbox_test");
});

test("MIME 解析炸掉 → 仍按信封信息落库，收件人/发件人不丢", async () => {
  const env = makeEnv();
  const { thrown } = await run(await load(), makeMessage("x@example.com", { rawThrows: true }), env);
  assert.equal(thrown, null, "解析失败不等于这封信该丢");
  assert.equal(env.messages.length, 1);
  const m = env.messages[0];
  assert.equal(m.mail_from, "noreply@tm.openai.com", "发件人必须留住");
  assert.ok((m.text_body || "").includes("x@example.com"), "收件人必须留在正文里可追");
  assert.ok(m.subject, "标题至少从信头拿到");
});

test("完整记录写不进去 → 自动退回最小记录，信仍在", async () => {
  const env = makeEnv({ fail: { insertMessage: "full" } });
  const { thrown } = await run(await load(), makeMessage("x@example.com"), env);
  assert.equal(thrown, null);
  assert.equal(env.msgInsertAttempts, 2, "应当试了完整 + 最小两次");
  assert.equal(env.messages.length, 1);
  assert.ok(env.messages[0].text_body.includes("正文入库失败"), "要说清正文没入库，别让人以为本来就是空的");
  assert.ok(env.messages[0].text_body.includes("x@example.com"), "信封信息要留住");
});

test("两级落库都失败 → **抛出**，让 CF 判定投递失败、发件方重试", async () => {
  const env = makeEnv({ fail: { insertMessage: "all" } });
  const { thrown, logs } = await run(await load(), makeMessage("x@example.com"), env);
  assert.ok(thrown, "必须抛出：静默 return 等于告诉 CF 已投递，这封信就永久消失了");
  assert.match(String(thrown), /failed to store inbound mail/);
  assert.ok(logs.some((l) => l.includes("mail_store_failed")), "要留下可排查的日志");
});

test("外域地址：不建信箱但信照收", async () => {
  const env = makeEnv();
  const { thrown } = await run(await load(), makeMessage("x@somebody-else.com"), env);
  assert.equal(thrown, null);
  assert.equal(env.mailboxes.length, 0, "不给别人家的域建信箱");
  assert.equal(env.messages.length, 1, "但信还是要收下");
});

test("畸形收件人也不丢信", async () => {
  for (const bad of ["", "no-at-sign"]) {
    const env = makeEnv();
    const { thrown } = await run(await load(), makeMessage(bad), env);
    assert.equal(thrown, null, `to=${JSON.stringify(bad)} 不该抛`);
    assert.equal(env.messages.length, 1, `to=${JSON.stringify(bad)} 的信也要落库`);
  }
});

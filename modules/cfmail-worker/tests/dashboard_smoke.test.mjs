// 直贴版（真正部署到 Cloudflare 的那一份）冒烟测试。
//
// 为什么需要它：`node --check` 只验语法，**抓不到未定义符号**。email handler 内部包了
// try/catch，ReferenceError 会被静默吞掉、只打一行日志，线上表现为「信悄悄丢了」。
// 所以这里真调用一次 handler，并监听 console.log 确认没有 worker error。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DASHBOARD = new URL("../deploy/cloudflare-dashboard/mail-inbox-dashboard.js", import.meta.url);

const RAW_MAIL = [
  "From: OpenAI <noreply@tm.openai.com>",
  "To: someone@example.com",
  "Subject: Your verification code",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Your code is 123456. Visit https://example.com/verify to continue.",
  "",
].join("\r\n");

function makeMessage(to, raw = RAW_MAIL) {
  return {
    from: "noreply@tm.openai.com",
    to,
    headers: new Map([["subject", "Your verification code"]]),
    raw: new TextEncoder().encode(raw).buffer,
  };
}

function makeEnv({ mailboxes = [], domains = ["example.com"] } = {}) {
  const messages = [];
  return {
    messages,
    mailboxes,
    DB: {
      prepare(sql) {
        return {
          _b: [],
          bind(...a) { this._b = a; return this; },
          async first() {
            if (sql.includes("FROM mail_settings")) return { value: "auto" };
            if (sql.includes("FROM mailboxes")) {
              const e = String(this._b[0] || "").toLowerCase();
              return mailboxes.find((m) => m.email.toLowerCase() === e) || null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM domains")) return { results: domains.map((d) => ({ domain: d })) };
            return { results: [] };
          },
          async run() {
            if (sql.includes("INTO messages")) {
              const [id, mailbox_id, mail_from, subject, text_body, html_body, code, link] = this._b;
              messages.push({ id, mailbox_id, mail_from, subject, text_body, html_body, code, link });
            } else if (sql.includes("INTO mailboxes")) {
              const [id, email, domain, subdomain, local_part, fingerprint, status] = this._b;
              mailboxes.push({ id, email, domain, subdomain, local_part, fingerprint, status });
            }
            return { success: true };
          },
        };
      },
    },
  };
}

/** 跑 handler，同时捕获它 try/catch 吞掉的错误日志。 */
async function runHandler(worker, message, env) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.map(String).join(" "));
  try {
    await worker.email(message, env);
  } finally {
    console.log = orig;
  }
  const errors = logs.filter((l) => l.includes("email worker error"));
  return { logs, errors };
}

test("直贴版源码里没有残留的未定义符号（真调用一次 handler）", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv();
  const { errors } = await runHandler(worker, makeMessage("someone@example.com"), env);
  assert.deepEqual(errors, [], "handler 内部抛错了（很可能是未定义符号）");
});

test("发往未创建地址的信 → 自动建信箱，不再落进 inbox_test", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv();
  await runHandler(worker, makeMessage("never-created@example.com"), env);

  assert.equal(env.mailboxes.length, 1, "应当自动建了一个信箱");
  assert.equal(env.mailboxes[0].email, "never-created@example.com");
  assert.equal(env.mailboxes[0].fingerprint, "auto-inbound");

  assert.equal(env.messages.length, 1, "信必须照常入库");
  assert.equal(env.messages[0].mailbox_id, env.mailboxes[0].id);
  assert.notEqual(env.messages[0].mailbox_id, "inbox_test", "邮件不能落入共用兜底信箱");
});

test("验证码照常提取（自动建信箱没破坏原有能力）", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv();
  await runHandler(worker, makeMessage("code@example.com"), env);
  assert.equal(env.messages[0].code, "123456");
  assert.equal(env.messages[0].link, "https://example.com/verify");
});

test("直贴版入库的验证码保持原始大小写（改了 src 必须重跑 build:dashboard）", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv();
  await runHandler(worker, makeMessage("case@example.com", RAW_MAIL.replace("Your code is 123456.", "Your verification code is aB3dE9.")), env);
  assert.equal(env.messages[0].code, "aB3dE9");
});

test("已存在的信箱复用，不重复建", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv({ mailboxes: [{ id: "mbx_known", email: "known@example.com" }] });
  await runHandler(worker, makeMessage("known@example.com"), env);
  assert.equal(env.mailboxes.length, 1);
  assert.equal(env.messages[0].mailbox_id, "mbx_known");
});

test("外域地址仍走兜底桶，不给别人家的域建信箱", async () => {
  const worker = (await import(DASHBOARD)).default;
  const env = makeEnv();
  await runHandler(worker, makeMessage("x@somebody-else.com"), env);
  assert.equal(env.mailboxes.length, 0);
  assert.equal(env.messages[0].mailbox_id, "inbox_test");
});

test("直贴版与 src 的自动建信箱逻辑同源（防止两份实现漂移）", () => {
  const dash = readFileSync(new URL(DASHBOARD), "utf8");
  const src = readFileSync(new URL("../src/mailbox_registry.mjs", import.meta.url), "utf8");
  const marker = "async function ensureMailboxId(env, email) {";
  assert.ok(dash.includes(marker), "直贴版必须内联了 ensureMailboxId");
  // src 里是 export 形式，直贴版被 strip_exports 去掉 export —— 主体应完全一致
  const body = src.slice(src.indexOf(marker.replace("async function", "export async function")));
  const stripped = body.replace(/^export\s+/gm, "");
  assert.ok(dash.includes(stripped.trim()), "两边逻辑已漂移：改了 src 却没重跑 build:dashboard");
});

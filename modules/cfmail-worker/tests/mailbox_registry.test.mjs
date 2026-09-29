// mailbox_registry 的行为测试。零依赖，用 node --test 跑。
// 重点：自动建信箱**绝不能因为任何异常影响收信**，且只给自家域建。
import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureMailboxId,
  readMailbox,
  FALLBACK_MAILBOX_ID,
  AUTO_FINGERPRINT,
} from "../src/mailbox_registry.mjs";

/** 极简 D1 桩：mailboxes 与 domains 两张表在内存里。 */
function makeEnv({ mailboxes = [], domains = ["example.com"], failInsert = false } = {}) {
  const inserts = [];
  return {
    inserts,
    mailboxes,
    DB: {
      prepare(sql) {
        return {
          _binds: [],
          bind(...args) { this._binds = args; return this; },
          async first() {
            if (sql.includes("FROM mailboxes")) {
              const email = String(this._binds[0] || "").toLowerCase();
              return mailboxes.find((m) => m.email.toLowerCase() === email) || null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM domains")) {
              return { results: domains.map((d) => ({ domain: d })) };
            }
            return { results: [] };
          },
          async run() {
            if (failInsert) throw new Error("UNIQUE constraint failed");
            const [id, email, domain, subdomain, localPart, fingerprint, status] = this._binds;
            const row = { id, email, domain, subdomain, local_part: localPart, fingerprint, status };
            inserts.push(row);
            mailboxes.push(row);
            return { success: true };
          },
        };
      },
    },
  };
}

test("已存在的信箱直接返回其 id，不重复创建", async () => {
  const env = makeEnv({ mailboxes: [{ id: "mbx_old", email: "a@example.com" }] });
  assert.equal(await ensureMailboxId(env, "a@example.com"), "mbx_old");
  assert.equal(env.inserts.length, 0);
});

test("未知地址会自动建信箱（这是本次修复的核心）", async () => {
  const env = makeEnv();
  const id = await ensureMailboxId(env, "brand-new@example.com");
  assert.notEqual(id, FALLBACK_MAILBOX_ID, "不能再退回共用桶");
  assert.match(id, /^mbx_/);
  assert.equal(env.inserts.length, 1);
  assert.equal(env.inserts[0].email, "brand-new@example.com");
  assert.equal(env.inserts[0].domain, "example.com");
  assert.equal(env.inserts[0].subdomain, null);
  assert.equal(env.inserts[0].local_part, "brand-new");
  assert.equal(env.inserts[0].fingerprint, AUTO_FINGERPRINT, "要能和手动创建的区分开");
});

test("子域名地址归到根域，subdomain 单独记", async () => {
  const env = makeEnv();
  await ensureMailboxId(env, "ggg@mail.example.com");
  assert.equal(env.inserts[0].domain, "example.com");
  assert.equal(env.inserts[0].subdomain, "mail");
});

test("不是自家域的一律不建，回兜底桶", async () => {
  const env = makeEnv();
  assert.equal(await ensureMailboxId(env, "x@evil.com"), FALLBACK_MAILBOX_ID);
  assert.equal(await ensureMailboxId(env, "x@evil-example.com"), FALLBACK_MAILBOX_ID);
  assert.equal(await ensureMailboxId(env, "x@example.com.evil.net"), FALLBACK_MAILBOX_ID);
  assert.equal(env.inserts.length, 0);
});

test("畸形地址不炸，回兜底桶", async () => {
  const env = makeEnv();
  for (const bad of ["", "no-at-sign", "@nolocal.com"]) {
    assert.equal(await ensureMailboxId(env, bad), FALLBACK_MAILBOX_ID);
  }
});

test("INSERT 失败时不抛异常（收信绝不能被建信箱拖垮）", async () => {
  const env = makeEnv({ failInsert: true });
  const id = await ensureMailboxId(env, "boom@example.com");
  assert.equal(id, FALLBACK_MAILBOX_ID, "失败要兜底，不能让 email handler 抛出去");
});

test("并发撞车：INSERT 失败但别人已建好，应复用那一个", async () => {
  const shared = [];
  const env = makeEnv({ mailboxes: shared, failInsert: true });
  // 模拟另一并发请求在我们 INSERT 失败的瞬间已经插入成功
  const origPrepare = env.DB.prepare.bind(env.DB);
  let firstLookup = true;
  env.DB.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (sql.includes("FROM mailboxes")) {
      const origFirst = stmt.first.bind(stmt);
      stmt.first = async () => {
        if (firstLookup) { firstLookup = false; return null; }
        return { id: "mbx_by_other", email: "race@example.com" };
      };
      void origFirst;
    }
    return stmt;
  };
  assert.equal(await ensureMailboxId(env, "race@example.com"), "mbx_by_other");
});

test("readMailbox 大小写不敏感", async () => {
  const env = makeEnv({ mailboxes: [{ id: "mbx_1", email: "Mixed@Example.com" }] });
  assert.ok(await readMailbox(env, "mixed@example.com"));
});

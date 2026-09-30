import test from "node:test";
import assert from "node:assert/strict";
import inbox from "../src/mail-inbox.js";
import api from "../src/mail-api.js";
import dashboardInbox from "../deploy/cloudflare-dashboard/mail-inbox-dashboard.js";
import dashboardApi from "../deploy/cloudflare-dashboard/mail-api-dashboard.js";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createTestD1 } from "../../../kit/tests/helpers/sqlite-d1.mjs";

function envFor(t) {
  const DB = createTestD1(t);
  DB.sqlite.exec("INSERT INTO domains (id, domain, created_at) VALUES ('d', 'example.com', '2026-01-01')");
  return { DB, ADMIN_TOKEN: "test-admin", SITE_PASSWORD: "test-site" };
}
function request(path, body, auth = true) {
  return new Request(`https://api.example.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(auth ? { "x-admin-auth": "test-admin" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function message(to) {
  return {
    to, from: "sender@example.org", headers: new Headers({ subject: "Verification code" }),
    rejected: false, rawReads: 0,
    setReject(reason) { this.rejected = reason; },
    get raw() {
      this.rawReads += 1;
      return new TextEncoder().encode("Subject: Verification code\r\nContent-Type: text/plain\r\n\r\nYour code is 123456.");
    },
  };
}
const count = (env, table) => env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

for (const [name, worker, http] of [["source", inbox, api], ["dashboard", dashboardInbox, dashboardApi]]) {
  test(`${name}: default registered mode rejects unknown recipients before parsing or writes`, async (t) => {
    const env = envFor(t);
    for (const modeRow of [true, false]) {
      if (!modeRow) env.DB.sqlite.exec("DELETE FROM mail_settings");
      const mail = message("random@example.com");
      await worker.email(mail, env);
      assert.ok(mail.rejected);
      assert.equal(mail.rawReads, 0);
      assert.equal(count(env, "mailboxes"), 0);
      assert.equal(count(env, "messages"), 0);
    }
  });

  test(`${name}: settings require credentials, validate modes and persist across requests`, async (t) => {
    const env = envFor(t);
    for (const body of [undefined, { receive_mode: "auto" }]) {
      assert.equal((await http.fetch(request("/admin/settings/receiving", body, false), env)).status, 401);
    }
    for (const receive_mode of ["invalid", null, true, "AUTO"]) {
      assert.equal((await http.fetch(request("/admin/settings/receiving", { receive_mode }), env)).status, 400);
    }
    for (const receive_mode of ["auto", "registered"]) {
      assert.equal((await http.fetch(request("/admin/settings/receiving", { receive_mode }), env)).status, 200);
      const get = await http.fetch(request("/admin/settings/receiving"), { ...env });
      assert.equal(get.headers.get("cache-control"), "no-store");
      assert.equal((await get.json()).receive_mode, receive_mode);
    }
  });

  test(`${name}: auto receipt, strict rejection, manual re-registration and code extraction`, async (t) => {
    const env = envFor(t);
    await http.fetch(request("/admin/settings/receiving", { receive_mode: "auto" }), env);
    await worker.email(message("test@example.com"), env);
    const old = env.DB.sqlite.prepare("SELECT * FROM mailboxes").get();
    assert.equal(old.fingerprint, "auto-inbound");
    assert.equal(count(env, "messages"), 1);
    assert.equal(env.DB.sqlite.prepare("SELECT code FROM messages").get().code, "123456");

    await http.fetch(request("/admin/settings/receiving", { receive_mode: "registered" }), env);
    for (const email of ["random@example.com", "test@example.com"]) {
      const mail = message(email);
      await worker.email(mail, env);
      assert.ok(mail.rejected);
      assert.equal(mail.rawReads, 0);
    }
    assert.equal(count(env, "messages"), 1);
    const register = await http.fetch(request("/admin/new_address", { name: "test", domain: "example.com" }), env);
    assert.equal(register.status, 200);
    assert.equal((await register.json()).id, old.id, "registration must keep history linked");
    const mail = message("TEST@EXAMPLE.COM");
    await worker.email(mail, env);
    assert.equal(mail.rejected, false);
    assert.equal(count(env, "mailboxes"), 1);
    assert.equal(count(env, "messages"), 2);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE mailbox_id = ?").get(old.id).n, 2);
  });

  test(`${name}: disabled mailbox or domain cannot receive in registered mode`, async (t) => {
    const env = envFor(t);
    await http.fetch(request("/admin/new_address", { name: "known", domain: "example.com" }), env);
    for (const update of ["UPDATE mailboxes SET status = 'disabled'", "UPDATE mailboxes SET status = 'active'; UPDATE domains SET enabled = 0"]) {
      env.DB.sqlite.exec(update);
      const mail = message("known@example.com");
      await worker.email(mail, env);
      assert.ok(mail.rejected);
      assert.equal(mail.rawReads, 0);
    }
    assert.equal(count(env, "messages"), 0);
  });

  test(`${name}: policy/database failures never fall back to accepting unknown mail`, async (t) => {
    const env = envFor(t);
    env.DB.sqlite.exec("UPDATE mail_settings SET value = 'broken'");
    const mail = message("unknown@example.com");
    await assert.rejects(worker.email(mail, env), /Invalid receive mode/);
    env.DB.sqlite.exec("DROP TABLE mail_settings");
    await assert.rejects(worker.email(mail, env), /no such table/);
    assert.equal(mail.rawReads, 0);
    assert.equal(count(env, "messages"), 0);
    assert.equal(count(env, "mailboxes"), 0);
  });
}

test("migration 0003: fresh installs start registered, upgrades that already hold mail keep auto", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const modeAfterUpgrade = (seed) => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(new URL("../../../kit/schema/0000_base.sql", import.meta.url), "utf8"));
      for (const f of files.filter((f) => f < "0003")) db.exec(readFileSync(new URL(f, dir), "utf8"));
      if (seed) db.exec(seed);
      for (const f of files.filter((f) => f >= "0003")) db.exec(readFileSync(new URL(f, dir), "utf8"));
      return db.prepare("SELECT value FROM mail_settings WHERE key = 'receive_mode'").get().value;
    } finally { db.close(); }
  };
  assert.equal(modeAfterUpgrade(), "registered");
  assert.equal(modeAfterUpgrade(`INSERT INTO mailboxes (id, email, domain, local_part, fingerprint, created_at, expires_at)
    VALUES ('m', 'old@example.com', 'example.com', 'old', 'auto-inbound', '2026-01-01', '2099-01-01')`), "auto");
  assert.equal(modeAfterUpgrade(`INSERT INTO messages (id, mailbox_id, received_at) VALUES ('x', 'inbox_test', '2026-01-01')`), "auto");
});

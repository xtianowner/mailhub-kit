import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareTestMailbox } from "../scripts/lib/test-mailbox.mjs";

// 测试值运行时生成，不在源码里写像凭据的字面量（发布前的密钥扫描会拦）。
const MAILBOX_TOKEN = randomUUID();

function fixture(boxes = [], domains = ["example.org"]) {
  const writes = [];
  const request = async (route, init) => {
    if (route === "/admin/domains") return { domains };
    if (route.startsWith("/admin/mailboxes?")) return { results: boxes };
    writes.push(init.body);
    return { id: "kept-id", email: `${init.body.name}@${init.body.domain}`, token: MAILBOX_TOKEN };
  };
  return { writes, request, domain: "example.org" };
}

test("prepare-test registers the intended recipient, returns no token, and keeps manually registered mailboxes", async () => {
  const f = fixture();
  assert.equal(await prepareTestMailbox(f), "test@example.org");
  assert.deepEqual(f.writes, [{ name: "test", domain: "example.org" }]);
  const existing = fixture([{ email: "test@example.org", status: "active", fingerprint: null }]);
  assert.equal(await prepareTestMailbox(existing), "test@example.org");
  assert.equal(existing.writes.length, 0);
});

test("prepare-test registers auto-inbound recipients but never silently reactivates a disabled mailbox", async () => {
  const auto = fixture([{ email: "test@example.org", status: "active", fingerprint: "auto-inbound" }]);
  await prepareTestMailbox(auto);
  assert.equal(auto.writes.length, 1);
  const disabled = fixture([{ email: "test@example.org", status: "disabled" }]);
  await assert.rejects(prepareTestMailbox(disabled), (e) => e.code === 10);
  assert.equal(disabled.writes.length, 0);
});

test("prepare-test refuses foreign/invalid addresses and disabled domains without writes", async () => {
  for (const address of ["a@other.org", "a@b@example.org", "@example.org", "a b@example.org"]) {
    const f = fixture();
    await assert.rejects(prepareTestMailbox({ ...f, address }), (e) => e.code === 2);
    assert.equal(f.writes.length, 0);
  }
  const disabled = fixture([], []);
  await assert.rejects(prepareTestMailbox(disabled), /域名未启用/);
  assert.equal(disabled.writes.length, 0);
});

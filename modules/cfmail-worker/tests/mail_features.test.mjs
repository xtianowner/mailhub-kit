import assert from "node:assert/strict";
import test from "node:test";

import mailInbox from "../src/mail-inbox.js";
import { loadInlineImages } from "../src/mail_attachments.mjs";
import { parseEmailContentFromRaw } from "../src/raw_mail_parser.mjs";
import { getSendingStatus, sendDomainMail, SendMailError } from "../src/mail_send.mjs";

function latin1Raw(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff).buffer;
}

function makeInboundEnv() {
  const state = { messages: [], attachments: [], objects: new Map() };
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          if (sql.includes("FROM mailboxes")) {
            return { id: "mbx_test", email: "hello@example.net" };
          }
          return null;
        },
        async all() {
          if (sql.includes("message_attachments")) {
            return { results: state.attachments.map((row) => ({ ...row })) };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INTO messages")) {
            state.messages.push({
              id: args[0], subject: args[3], text_body: args[4], html_body: args[5],
              code: args[6],
              message_id: args[9], in_reply_to: args[10], references_header: args[11],
            });
          } else if (sql.includes("INTO message_attachments")) {
            state.attachments.push({
              id: args[0], message_id: args[1], r2_key: args[2], filename: args[3],
              content_type: args[4], content_id: args[5], disposition: args[6],
              size: args[7], created_at: args[8],
            });
          }
          return { success: true };
        },
      };
    },
  };
  const ATTACHMENTS = {
    async put(key, value) {
      state.objects.set(key, new Uint8Array(value));
    },
    async get(key) {
      const bytes = state.objects.get(key);
      return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
    },
    async delete(key) {
      state.objects.delete(key);
    },
  };
  return { DB, ATTACHMENTS, state };
}

test("未声明字符集的 UTF-8 正文不会被当作 latin1 乱码", async () => {
  const body = Buffer.from("验证码：你好 123456", "utf8").toString("base64");
  const parsed = await parseEmailContentFromRaw(latin1Raw(
    `Subject: test\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`,
  ));
  assert.match(parsed.textBody, /验证码:你好 123456/);
});

test("声明 UTF-8 但实际为 GB18030 时会严格失败后回退", async () => {
  const parsed = await parseEmailContentFromRaw(latin1Raw(
    "Subject: test\r\nContent-Type: text/plain; charset=utf-8\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n1tDOxA==",
  ));
  assert.equal(parsed.textBody, "中文");
});

test("收件原始流只读一次，中文与 CID Logo 均被保存", async () => {
  const env = makeInboundEnv();
  const subject = Buffer.from("欢迎使用 MailHub", "utf8").toString("base64");
  const html = Buffer.from("<p>你好</p><img src=\"cid:brand-logo\">", "utf8").toString("base64");
  const rawText = [
    `Subject: =?UTF-8?B?${subject}?=`,
    "Message-ID: <message-001@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/related; boundary=mailhub",
    "",
    "--mailhub",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    html,
    "--mailhub",
    "Content-Type: image/png; name=logo.png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <brand-logo>",
    "",
    "iVBORw0KGgo=",
    "--mailhub--",
    "",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(rawText);
  const raw = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  await mailInbox.email({
    raw,
    from: "sender@example.com",
    to: "hello@example.net",
    headers: new Headers({ subject: `=?UTF-8?B?${subject}?=` }),
  }, env);

  assert.equal(env.state.messages.length, 1);
  assert.equal(env.state.messages[0].subject, "欢迎使用 MailHub");
  assert.equal(env.state.messages[0].message_id, "<message-001@example.com>");
  assert.match(env.state.messages[0].html_body, /cid:brand-logo/);
  assert.equal(env.state.messages[0].code, null, "Logo 的 base64 不能被误识别为验证码");
  assert.equal(env.state.attachments.length, 1);
  assert.equal(env.state.attachments[0].content_id, "brand-logo");

  const images = await loadInlineImages(env, env.state.messages[0].id);
  assert.equal(images.length, 1);
  assert.equal(images[0].mime_type, "image/png");
  assert.equal(images[0].data_base64, "iVBORw0KGgo=");
});

function makeSendEnv() {
  const sent = [];
  const history = [];
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async all() {
          if (sql.includes("FROM domains")) return { results: [{ domain: "example.net" }] };
          if (sql.includes("FROM mailboxes")) return { results: [{ email: "hello@example.net" }] };
          return { results: [] };
        },
        async first() {
          if (sql.includes("FROM domains")) {
            return args[0] === "example.net" ? { domain: "example.net" } : null;
          }
          if (sql.includes("FROM mailboxes")) {
            return args[0] === "hello@example.net"
              ? { id: "mbx_test", email: "hello@example.net" }
              : null;
          }
          if (sql.includes("FROM messages")) {
            return { message_id: "<original@example.com>", references_header: "", subject: "原主题" };
          }
          return null;
        },
        async run() {
          if (sql.includes("INTO sent_messages")) history.push(args);
          return { success: true };
        },
      };
    },
  };
  const EMAIL = {
    async send(message) {
      sent.push(message);
      return { messageId: "provider-001" };
    },
  };
  return { DB, EMAIL, sent, history };
}

test("发件状态只返回已开通域名中的有效信箱", async () => {
  const env = makeSendEnv();
  const status = await getSendingStatus(env);
  assert.equal(status.available, true);
  assert.deepEqual(status.domains, ["example.net"]);
  assert.deepEqual(status.from_addresses, ["hello@example.net"]);
});

test("域名发件同时生成 UTF-8 text/html，并保存 Cloudflare 接受结果", async () => {
  const env = makeSendEnv();
  const result = await sendDomainMail(env, {
    from: "hello@example.net",
    to: "reader@example.com",
    subject: "中文主题",
    text: "你好，世界",
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.provider_message_id, "provider-001");
  assert.equal(env.sent[0].text, "你好，世界");
  assert.match(env.sent[0].html, /你好，世界/);
  assert.equal(env.history.length, 1);
});

test("回复邮件携带标准线程头", async () => {
  const env = makeSendEnv();
  await sendDomainMail(env, {
    from: "hello@example.net",
    to: "reader@example.com",
    subject: "",
    text: "收到",
    reply_to_message_id: "msg_original",
  });
  assert.equal(env.sent[0].subject, "Re: 原主题");
  assert.equal(env.sent[0].headers["In-Reply-To"], "<original@example.com>");
});

test("未开通域名不能冒充发件", async () => {
  const env = makeSendEnv();
  await assert.rejects(
    sendDomainMail(env, {
      from: "hello@not-enabled.example",
      to: "reader@example.com",
      subject: "test",
      text: "test",
    }),
    (error) => error instanceof SendMailError && error.code === "sender_domain_not_enabled",
  );
});

import { htmlToText, normalizeText } from "./verification_extractor.mjs";
import { loadInlineImages } from "./mail_attachments.mjs";
import { getSendingStatus, sendDomainMail, SendMailError } from "./mail_send.mjs";
import { getReceiveMode, setReceiveMode, RECEIVE_MODES } from "./mail_security.mjs";

const UI_HTML = `<!doctype html>

<html lang="zh-CN">

<head>

<meta charset="UTF-8" />

<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<title>CF 邮箱 WebUI</title>

<style>

body {

margin: 0;

font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;

background: linear-gradient(180deg, #fff7fb 0%, #fff0f7 100%);

color: #5c3552;

}

.wrap {

max-width: 1100px;

margin: 0 auto;

padding: 24px;

}

h1 {

margin: 0 0 8px 0;

color: #b14d86;

}

h2 {

color: #b14d86;

}

.muted {

color: #a27491;

}

.grid {

display: grid;

grid-template-columns: 1fr 1fr;

gap: 16px;

margin-top: 18px;

}

.card {

background: rgba(255, 255, 255, 0.82);

border: 1px solid #f2cfe0;

border-radius: 20px;

padding: 18px;

box-shadow: 0 12px 30px rgba(214, 138, 177, 0.14);

backdrop-filter: blur(10px);

}

@media (max-width: 900px) {

.grid {

grid-template-columns: 1fr;

}

}

label {

display: block;

font-size: 13px;

color: #a27491;

margin: 10px 0 6px;

}

input {

width: 100%;

background: #fff8fc;

color: #6b3f59;

border: 1px solid #efcade;

border-radius: 14px;

padding: 12px;

font-size: 14px;

box-sizing: border-box;

outline: none;

}

input:focus {

border-color: #df8eb8;

box-shadow: 0 0 0 3px rgba(223, 142, 184, 0.12);

}

button {

border: 0;

border-radius: 14px;

padding: 10px 14px;

color: white;

background: linear-gradient(135deg, #e98fb7 0%, #d870aa 100%);

cursor: pointer;

margin-right: 8px;

margin-top: 12px;

box-shadow: 0 8px 18px rgba(216, 112, 170, 0.18);

}

button.secondary {

background: linear-gradient(135deg, #d9a3bc 0%, #c98aac 100%);

}

button.success {

background: linear-gradient(135deg, #f08fb7 0%, #e06da3 100%);

}

.status {

margin-top: 12px;

white-space: pre-wrap;

font-size: 14px;

}

.ok {

color: #bf4d84;

}

.err {

color: #d14f71;

}

.info {

color: #8d6280;

}

.mailbox {

margin-top: 14px;

padding: 14px;

border-radius: 16px;

background: #fff6fb;

border: 1px dashed #e6b4cc;

}

.mailbox .email {

font-size: 22px;

font-weight: 700;

word-break: break-all;

color: #b14d86;

}

.code-wrap {

display: none;

margin-top: 12px;

padding: 14px;

border-radius: 16px;

background: #fff4fa;

border: 1px solid #efcade;

box-shadow: 0 8px 20px rgba(216,112,170,0.10);

}

.code {

font-size: 32px;

font-weight: 800;

letter-spacing: 3px;

margin-top: 8px;

color: #c24d8a;

}

table {

width: 100%;

border-collapse: collapse;

margin-top: 12px;

}

th, td {

text-align: left;

padding: 12px 8px;

border-bottom: 1px solid #f1d7e3;

vertical-align: top;

}

th {

color: #a27491;

}

.mono {

font-family: ui-monospace, SFMono-Regular, Menlo, monospace;

}

.small {

font-size: 12px;

}

.mail-detail {

margin-top: 8px;

}

.mail-detail summary {

cursor: pointer;

color: #b14d86;

}

.mail-full {

white-space: pre-wrap;

word-break: break-word;

background: #fff8fc;

border: 1px solid #efcade;

border-radius: 12px;

padding: 10px;

margin-top: 6px;

max-height: 220px;

overflow: auto;

}

</style>

</head>

<body>

<div class="wrap">

<h1>CF 邮箱 WebUI</h1>

<div class="muted">创建邮箱、查询邮件、查看最新验证码</div>

  

<div class="grid">

<div class="card">

<h2>连接配置</h2>

<label>管理员 Token</label>

<input id="adminToken" type="password" placeholder="x-admin-auth" />

  

<label>站点密码</label>

<input id="sitePassword" type="password" placeholder="用于 /api/mailboxes/code" />

  

<div>

<button id="saveConfigBtn" class="success">保存配置</button>

<button id="testBtn" class="secondary">测试连接</button>

</div>

<div id="configStatus" class="status"></div>

</div>

  

<div class="card">

<h2>创建邮箱</h2>

<label>前缀（可选）</label>

<input id="createName" placeholder="例如 gpt001" />

  

<label>domain（可选）</label>

<input id="createDomain" placeholder="留空则用默认域名" />

  

<div>

<button id="createBtn">创建邮箱</button>

<button id="randomBtn" class="secondary">随机创建</button>

</div>

  

<div id="createdBox" class="mailbox" style="display:none;">

<div class="muted small">刚创建的邮箱</div>

<div id="createdEmail" class="email">-</div>

<div id="createdMeta" class="muted small mono"></div>

<div>

<button id="copyEmailBtn" class="success">复制邮箱</button>

<button id="useQueryBtn" class="secondary">用于查询</button>

</div>

</div>

<div id="createStatus" class="status"></div>

</div>

  

<div class="card" style="grid-column: 1 / -1;">

<h2>查询邮箱</h2>

<label>邮箱地址</label>

<input id="queryEmail" placeholder="例如 someone@example.com" />

  

<div>

<button id="loadMailsBtn">加载邮件</button>

<button id="loadCodeBtn" class="success">获取最新验证码</button>

<button id="autoBtn" class="secondary">开启自动刷新</button>

</div>

  

<div id="latestCodeWrap" class="code-wrap">

<div class="muted small">最新验证码</div>

<div id="latestCode" class="code">-</div>

<button id="copyCodeBtn" class="success">复制验证码</button>

</div>

  

<div id="queryStatus" class="status"></div>

  

<table>

<thead>

<tr>

<th style="width:160px;">时间</th>

<th>主题 / 内容</th>

<th style="width:120px;">验证码</th>

</tr>

</thead>

<tbody id="mailRows">

<tr><td colspan="3" class="muted">暂无数据</td></tr>

</tbody>

</table>

</div>

</div>

</div>

  

<script src="/ui/app.js"></script>

</body>

</html>`;

  

const UI_SCRIPT = `

(function () {

var timer = null;

  

function $(id) {

return document.getElementById(id);

}

  

function setStatus(id, type, text) {

var el = $(id);

if (!el) return;

el.className = 'status ' + type;

el.textContent = text || '';

}

  

function loadCfg() {

var admin = localStorage.getItem('cf_admin_token') || '';

var site = localStorage.getItem('cf_site_password') || '';

if ($('adminToken')) $('adminToken').value = admin;

if ($('sitePassword')) $('sitePassword').value = site;

}

  

function saveCfg() {

localStorage.setItem('cf_admin_token', $('adminToken').value.trim());

localStorage.setItem('cf_site_password', $('sitePassword').value.trim());

setStatus('configStatus', 'ok', '配置已保存。');

}

  

function escapeHtml(text) {

return String(text == null ? '' : text)

.replace(/&/g, '&amp;')

.replace(/</g, '&lt;')

.replace(/>/g, '&gt;')

.replace(/"/g, '&quot;')

.replace(/'/g, '&#039;');

}

  

async function testConn() {

setStatus('configStatus', 'info', '正在测试连接...');

try {

var res = await fetch('/admin/mails?limit=1&offset=0&address=test-check@example.com', {

headers: { 'x-admin-auth': $('adminToken').value.trim() }

});

var text = await res.text();

if (res.status === 200 || res.status === 400) {

setStatus('configStatus', 'ok', '接口可访问，HTTP ' + res.status);

} else {

setStatus('configStatus', 'err', '连接失败，HTTP ' + res.status + '\\n' + text);

}

} catch (e) {

setStatus('configStatus', 'err', '测试失败：' + e.message);

}

}

  

async function createMailbox(randomOnly) {

setStatus('createStatus', 'info', '正在创建邮箱...');

try {

var payload = { enablePrefix: true };

var name = $('createName').value.trim();

var domain = $('createDomain').value.trim();

if (!randomOnly && name) payload.name = name;

if (domain) payload.domain = domain;

  

var res = await fetch('/admin/new_address', {

method: 'POST',

headers: {

'Content-Type': 'application/json',

'x-admin-auth': $('adminToken').value.trim()

},

body: JSON.stringify(payload)

});

var data = await res.json();

if (!res.ok) throw new Error(JSON.stringify(data));

  

$('createdBox').style.display = 'block';

$('createdEmail').textContent = data.email || data.address || '-';

$('createdMeta').textContent = 'id=' + (data.id || '') + ' token=' + (data.token || data.jwt || '');

setStatus('createStatus', 'ok', '邮箱创建成功。');

} catch (e) {

setStatus('createStatus', 'err', '创建失败：' + e.message);

}

}

  

function renderRows(rows) {

var body = $('mailRows');

if (!body) return;

if (!rows.length) {

body.innerHTML = '<tr><td colspan="3" class="muted">暂无邮件</td></tr>';

return;

}

body.innerHTML = rows.map(function (r) {

return '<tr>' +

'<td class="mono small">' + escapeHtml(r.created_at || '') + '</td>' +

'<td>' +

'<div><strong>' + escapeHtml(r.subject || '(无主题)') + '</strong></div>' +

'<div class="muted small">' + escapeHtml(r.preview || r.raw || r.text || '') + '</div>' +

'<details class="mail-detail">' +

'<summary>查看完整内容</summary>' +

'<div class="small muted">文本正文</div>' +

'<div class="mail-full">' + escapeHtml(r.text || '') + '</div>' +

'<div class="small muted">HTML 内容</div>' +

'<div class="mail-full">' + escapeHtml(r.html || '') + '</div>' +

'</details>' +

'</td>' +

'<td class="mono">' + escapeHtml(r.code || '未识别') + '</td>' +

'</tr>';

}).join('');

}

  

async function loadMails() {

var email = $('queryEmail').value.trim();

if (!email) {

setStatus('queryStatus', 'err', '请先输入邮箱地址。');

return;

}

setStatus('queryStatus', 'info', '正在加载邮件...');

try {

var res = await fetch('/admin/mails?limit=20&offset=0&address=' + encodeURIComponent(email), {

headers: { 'x-admin-auth': $('adminToken').value.trim() }

});

var data = await res.json();

if (!res.ok) throw new Error(JSON.stringify(data));

renderRows(data.results || []);

setStatus('queryStatus', 'ok', '已加载 ' + ((data.results || []).length) + ' 封邮件。');

} catch (e) {

setStatus('queryStatus', 'err', '加载失败：' + e.message);

}

}

  

async function loadCode() {

var email = $('queryEmail').value.trim();

var password = $('sitePassword').value.trim();

if (!email) {

setStatus('queryStatus', 'err', '请先输入邮箱地址。');

return;

}

if (!password) {

setStatus('queryStatus', 'err', '请先填写站点密码。');

return;

}

setStatus('queryStatus', 'info', '正在获取最新验证码...');

try {

var res = await fetch('/api/mailboxes/code?password=' + encodeURIComponent(password) + '&email=' + encodeURIComponent(email));

var data = await res.json();

if (!res.ok || data.ok === false) throw new Error(JSON.stringify(data));

$('latestCodeWrap').style.display = 'block';

$('latestCode').textContent = data.code || '-';

var latest = data.message || data.latest_message || null;

if (data.code) {

setStatus('queryStatus', 'ok', '已获取最新验证码。');

} else if (latest) {

var statusText = '最新一封邮件已收到，但暂未识别出验证码。';

if (latest.subject) statusText += '\\n主题：' + latest.subject;

if (latest.created_at || latest.received_at) statusText += '\\n时间：' + (latest.created_at || latest.received_at);

setStatus('queryStatus', 'info', statusText);

} else {

setStatus('queryStatus', 'ok', '当前还没有任何邮件。');

}

} catch (e) {

setStatus('queryStatus', 'err', '获取失败：' + e.message);

}

}

  

function toggleAuto() {

if (timer) {

clearInterval(timer);

timer = null;

$('autoBtn').textContent = '开启自动刷新';

setStatus('queryStatus', 'info', '自动刷新已关闭。');

return;

}

timer = setInterval(async function () {

if ($('queryEmail').value.trim()) {

await loadMails();

await loadCode();

}

}, 5000);

$('autoBtn').textContent = '关闭自动刷新';

setStatus('queryStatus', 'ok', '自动刷新已开启，每 5 秒刷新一次。');

}

  

async function copyText(text, okMsg) {

try {

await navigator.clipboard.writeText(text);

setStatus('queryStatus', 'ok', okMsg);

} catch (e) {

setStatus('queryStatus', 'err', '复制失败：' + e.message);

}

}

  

function bind() {

if ($('saveConfigBtn')) $('saveConfigBtn').addEventListener('click', saveCfg);

if ($('testBtn')) $('testBtn').addEventListener('click', testConn);

if ($('createBtn')) $('createBtn').addEventListener('click', function () { createMailbox(false); });

if ($('randomBtn')) $('randomBtn').addEventListener('click', function () { createMailbox(true); });

if ($('loadMailsBtn')) $('loadMailsBtn').addEventListener('click', loadMails);

if ($('loadCodeBtn')) $('loadCodeBtn').addEventListener('click', loadCode);

if ($('autoBtn')) $('autoBtn').addEventListener('click', toggleAuto);

if ($('copyEmailBtn')) $('copyEmailBtn').addEventListener('click', function () { copyText($('createdEmail').textContent, '邮箱已复制。'); });

if ($('copyCodeBtn')) $('copyCodeBtn').addEventListener('click', function () { copyText($('latestCode').textContent, '验证码已复制。'); });

if ($('useQueryBtn')) $('useQueryBtn').addEventListener('click', function () {

$('queryEmail').value = $('createdEmail').textContent;

setStatus('queryStatus', 'info', '已将当前邮箱填入查询框。');

});

}

  

loadCfg();

bind();

})();

`;

  

// ── CORS ──────────────────────────────────────────────────────────────
// 云端版前端（Cloudflare Pages，独立域名）是纯静态站，必须跨域调本 Worker。
// 密钥仍是真正的门禁：没有 x-admin-auth / password，放开 CORS 也读不到任何东西。
//
// CORS_ORIGINS 环境变量（逗号分隔）可精确限定来源；不设则回显请求方 Origin。
// 回显是安全的：浏览器同源策略保证别的站点读不到你在本站 localStorage 里的密钥。
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return {};
  const allow = String(env.CORS_ORIGINS || "").trim();
  if (allow) {
    const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.includes(origin)) return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-auth,x-admin-token,x-api-key",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function withCors(response, request, env) {
  const extra = corsHeaders(request, env);
  if (!Object.keys(extra).length) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(data, status = 200, headers = {}) {

return new Response(JSON.stringify(data), {

status,

headers: {

"content-type": "application/json; charset=UTF-8",
...headers

}

});

}

  

function htmlResponse(html, status = 200) {

return new Response(html, {

status,

headers: {

"content-type": "text/html; charset=UTF-8"

}

});

}

  

function jsResponse(js, status = 200) {

return new Response(js, {

status,

headers: {

"content-type": "application/javascript; charset=UTF-8"

}

});

}

  

function truncateText(text, maxLength = 220) {

const value = normalizeText(text || "");

if (!value) return "";

if (value.length <= maxLength) return value;

return value.slice(0, maxLength - 1) + "…";

}

  
function buildMessagePreview(row) {

const textBody = normalizeText(row?.text_body || "");

if (textBody) {

return truncateText(textBody);

}

const htmlBody = row?.html_body || "";

if (htmlBody) {

return truncateText(htmlToText(htmlBody));

}

return "";

}

  
function formatCreatedAt(receivedAt) {

if (!receivedAt) return "";

const dt = new Date(receivedAt);

if (Number.isNaN(dt.getTime())) return "";

dt.setSeconds(dt.getSeconds() + 30);

return dt.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

}

  
function mapMessageRow(row) {

if (!row) return null;

const preview = buildMessagePreview(row);

return {

id: row.id,

mailbox_id: row.mailbox_id || null,

mail_from: row.mail_from || null,

subject: row.subject || "",

text: row.text_body || "",

raw: row.text_body || row.html_body || "",

preview,

html: row.html_body || "",

code: row.code || null,

link: row.link || null,

received_at: row.received_at || "",

message_id: row.message_id || null,

in_reply_to: row.in_reply_to || null,

references: row.references_header || null,

created_at: formatCreatedAt(row.received_at)

};

}

  
function randomString(length = 8) {

const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

let result = "";

for (let i = 0; i < length; i++) {

result += chars[Math.floor(Math.random() * chars.length)];

}

return result;

}

  

async function readBody(request) {

const contentType = request.headers.get("content-type") || "";

  

try {

if (contentType.includes("application/json")) {

return await request.json();

}

  

if (

contentType.includes("application/x-www-form-urlencoded") ||

contentType.includes("multipart/form-data")

) {

const form = await request.formData();

const obj = {};

for (const [key, value] of form.entries()) {

obj[key] = typeof value === "string" ? value : String(value);

}

return obj;

}

} catch (e) {}

  

try {

const text = await request.text();

if (!text) return {};

try {

return JSON.parse(text);

} catch (e) {

return { raw: text };

}

} catch (e) {}

  

return {};

}

  

function extractAdminToken(request, body, url) {

const authHeader = request.headers.get("authorization") || "";

const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  

return (

request.headers.get("x-admin-auth") ||

request.headers.get("x-admin-token") ||

request.headers.get("x-api-key") ||

request.headers.get("x-token") ||

request.headers.get("x-site-password") ||

body?.admin_token ||

body?.adminToken ||

body?.token ||

body?.api_key ||

body?.apiKey ||

body?.password ||

url.searchParams.get("admin_token") ||

url.searchParams.get("adminToken") ||

url.searchParams.get("token") ||

url.searchParams.get("api_key") ||

url.searchParams.get("apiKey") ||

url.searchParams.get("password") ||

bearer ||

""

);

}

  

function isAdminAuthorized(token, env) {

return token && (token === env.ADMIN_TOKEN || token === env.SITE_PASSWORD);

}

  

function makeMailboxToken(email) {

return `cfw_${email}_${Date.now()}`;

}

  

async function createMailbox(env, request, body = {}, url = null) {

const rows = await env.DB

.prepare("SELECT * FROM domains WHERE enabled = 1")

.all();

  

const enabledDomains = (rows?.results || []).filter(Boolean);

if (!enabledDomains.length) {

return { error: "No enabled domain found" };

}

  

const rootDomains = enabledDomains

.map((row) => String(row.domain || "").trim().toLowerCase())

.filter(Boolean);

  

const requestedName = String(body?.name || "").trim().toLowerCase();

const localPart = requestedName || randomString(8);

  

let requestedDomain = String(body?.domain || "").trim().toLowerCase();

let finalDomain = requestedDomain || rootDomains[0];

  

const isAllowedDomain = rootDomains.some((root) => {

return finalDomain === root || finalDomain.endsWith("." + root);

});

  

if (!isAllowedDomain) {

finalDomain = rootDomains[0];

}

  

const matchedRoot = rootDomains.find((root) => {

return finalDomain === root || finalDomain.endsWith("." + root);

}) || rootDomains[0];

  

let subdomain = null;

if (finalDomain !== matchedRoot) {

subdomain = finalDomain.slice(0, -(matchedRoot.length + 1));

}

  

const email = `${localPart}@${finalDomain}`;

const mailboxId = `mbx_${Date.now()}_${randomString(6)}`;

const now = new Date().toISOString();

const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  

const fingerprint = request.headers.get("x-fingerprint") || body?.fingerprint || null;

  

await env.DB.prepare(

`INSERT INTO mailboxes

(id, email, domain, subdomain, local_part, fingerprint, status, created_at, expires_at)

VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(email) DO UPDATE SET fingerprint = excluded.fingerprint, status = 'active'`

)

.bind(

mailboxId,

email,

matchedRoot,

subdomain,

localPart,

fingerprint,

"active",

now,

expiresAt

)

.run();

  

const token = makeMailboxToken(email);

// Registering an automatically discovered address keeps its id and old messages.
const registered = await env.DB.prepare("SELECT id FROM mailboxes WHERE email = ? COLLATE NOCASE")
  .bind(email).first();

  

return {

id: registered?.id || mailboxId,

email,

address: email,

mailbox: email,

token,

jwt: token,

domain: finalDomain,

root_domain: matchedRoot,

subdomain,

expires_at: expiresAt

};

}

  

export default {

async fetch(request, env, ctx) {

// 预检请求不携带任何鉴权头，必须在所有鉴权分支之前直接放行，否则浏览器
// 连真正的请求都发不出去。
if (request.method === "OPTIONS") {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

return withCors(await handleRequest(request, env, ctx), request, env);

}

};

// 真正的路由分发。拆出来是为了让 fetch 只负责「预检放行 + 统一加 CORS 头」，
// 这样每条分支都不用各自记得加头。
async function handleRequest(request, env, ctx) {

try {

const url = new URL(request.url);

if (url.pathname === "/admin/settings/receiving") {
  if (!isAdminAuthorized(extractAdminToken(request, null, url), env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }
  if (request.method === "GET") {
    return json({ ok: true, receive_mode: await getReceiveMode(env) }, 200, { "cache-control": "no-store" });
  }
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }
    if (!RECEIVE_MODES.has(body?.receive_mode)) {
      return json({ ok: false, error: "receive_mode must be registered or auto" }, 400);
    }
    await setReceiveMode(env, body.receive_mode);
    return json({ ok: true, receive_mode: body.receive_mode }, 200, { "cache-control": "no-store" });
  }
  return json({ ok: false, error: "Method not allowed" }, 405);
}

  

if (request.method === "GET" && (url.pathname === "/ui" || url.pathname === "/ui/")) {

return htmlResponse(UI_HTML);

}

  

if (request.method === "GET" && url.pathname === "/ui/app.js") {

return jsResponse(UI_SCRIPT);

}

  

if (request.method === "GET" && url.pathname === "/") {

const result = await env.DB

.prepare("SELECT COUNT(*) as count FROM domains")

.first();

  

return json({ ok: true, domains: result?.count ?? 0 });

}

  

if (request.method === "GET" && url.pathname === "/api/messages/latest") {

const password = url.searchParams.get("password");

  

if (password !== env.SITE_PASSWORD) {

return json({ ok: false, error: "Invalid site password" }, 401);

}

  

const row = await env.DB.prepare(

`SELECT id, mailbox_id, mail_from, subject, text_body, html_body, code, link, received_at

FROM messages

ORDER BY received_at DESC

LIMIT 1`

).first();

  

return json({ ok: true, message: mapMessageRow(row) });

}

  

if (request.method === "GET" && url.pathname === "/api/mailboxes/code") {

const password = url.searchParams.get("password");

const email = (url.searchParams.get("email") || "").toLowerCase();

  

if (password !== env.SITE_PASSWORD) {

return json({ ok: false, error: "Invalid site password" }, 401);

}

  

if (!email) {

return json({ ok: false, error: "Missing email" }, 400);

}

  

const mailbox = await env.DB.prepare(

`SELECT id, email

FROM mailboxes

WHERE lower(email) = ?

LIMIT 1`

).bind(email).first();

  

if (!mailbox) {

return json({ ok: false, error: "Mailbox not found" }, 404);

}

  

const row = await env.DB.prepare(

`SELECT id, mailbox_id, subject, text_body, html_body, code, link, received_at

FROM messages

WHERE mailbox_id = ?

ORDER BY received_at DESC

LIMIT 1`

).bind(mailbox.id).first();

  

const messageRow = mapMessageRow(row);

return json({

ok: true,

email: mailbox.email,

mailbox_id: mailbox.id,

message: messageRow,

latest_message: messageRow,

code: messageRow?.code || null

});

}

  

if (request.method === "POST" && url.pathname === "/api/mailboxes") {

const body = await readBody(request);

  

if ((body.password || "") !== env.SITE_PASSWORD) {

return json({ ok: false, error: "Invalid site password" }, 401);

}

  

const created = await createMailbox(env, request, body, url);

if (created.error) {

return json({ ok: false, error: created.error }, 400);

}

  

return json({ ok: true, ...created });

}

  

if (request.method === "POST" && url.pathname === "/admin/new_address") {

const body = await readBody(request);

const token = extractAdminToken(request, body, url);

  

if (!isAdminAuthorized(token, env)) {

return json({

ok: false,

error: "Invalid admin token",

debug: {

bodyKeys: Object.keys(body || {}),

hasXAdminAuth: !!request.headers.get("x-admin-auth"),

hasXFingerprint: !!request.headers.get("x-fingerprint"),

hasXCustomAuth: !!request.headers.get("x-custom-auth")

}

}, 401);

}

  

const created = await createMailbox(env, request, body, url);

if (created.error) {

return json({ ok: false, error: created.error }, 400);

}

  

return json(created);

}

  

if (request.method === "GET" && url.pathname === "/admin/mails") {

const token = extractAdminToken(request, {}, url);

  

if (!isAdminAuthorized(token, env)) {

return json({ ok: false, error: "Invalid admin token" }, 401);

}

  

const address = (url.searchParams.get("address") || "").trim().toLowerCase();

const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 100);

const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  

if (!address) {

return json({ ok: false, error: "Missing address" }, 400);

}

  

const mailbox = await env.DB.prepare(

`SELECT id, email

FROM mailboxes

WHERE lower(email) = ?

LIMIT 1`

).bind(address).first();

  

if (!mailbox) {

return json({ results: [] });

}

  

const rows = await env.DB.prepare(

`SELECT id, mailbox_id, mail_from, subject, text_body, html_body, code, link, received_at

FROM messages

WHERE mailbox_id = ?

ORDER BY received_at DESC

LIMIT ? OFFSET ?`

).bind(mailbox.id, limit, offset).all();

  

const results = (rows?.results || []).map((row) => {

return mapMessageRow(row);

});

  
return json({ results });

}

// ── 以下三个端点为 mail-hub 统一层提供的发现接口 ────────────────────────
// 目的：让外部能「发现」信箱与邮件，而不必事先知道有哪些信箱。
// 全部只读、全部走 /admin/*（x-admin-auth），不改任何既有端点的行为。
// 注：本段刻意用常规单行距书写；本文件其余部分 55% 是空行，是粘贴产生的
//     双倍行距，非刻意风格。

// GET /admin/mailboxes?q=&limit=&offset=
// 列出**真实存在于 D1 的全部信箱**，带最近来信时间 / 最新验证码 / 邮件数。
// 这是「避免遗漏」的关键：调用方不需要预先猜测每个地址。
if (request.method === "GET" && url.pathname === "/admin/mailboxes") {
  const token = extractAdminToken(request, {}, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }

  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  // 左连接 messages 聚合：没收过信的信箱也要列出来（否则又是一种遗漏）。
  const where = q
    ? "WHERE lower(mb.email) LIKE ? OR lower(COALESCE(mb.label, '')) LIKE ? OR lower(COALESCE(mb.group_name, '')) LIKE ?"
    : "";
  const binds = q
    ? [`%${q}%`, `%${q}%`, `%${q}%`, limit, offset]
    : [limit, offset];

  const rows = await env.DB.prepare(
    `SELECT mb.id, mb.email, mb.domain, mb.subdomain, mb.local_part,
            mb.status, mb.created_at, mb.fingerprint, mb.label, mb.group_name,
            COUNT(m.id)        AS message_count,
            MAX(m.received_at) AS last_mail_at,
            -- 最近一封带验证码的信：列表里直接展示，不用逐个点「接码」（走 mailbox_id+received_at 索引）
            (SELECT c.code FROM messages c
              WHERE c.mailbox_id = mb.id AND c.code IS NOT NULL AND c.code != ''
              ORDER BY c.received_at DESC LIMIT 1) AS last_code,
            (SELECT c.received_at FROM messages c
              WHERE c.mailbox_id = mb.id AND c.code IS NOT NULL AND c.code != ''
              ORDER BY c.received_at DESC LIMIT 1) AS last_code_at
       FROM mailboxes mb
       LEFT JOIN messages m ON m.mailbox_id = mb.id
       ${where}
      GROUP BY mb.id
      ORDER BY (last_mail_at IS NULL), last_mail_at DESC, mb.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...binds).all();

  const results = (rows?.results || []).map((r) => ({
    id: r.id,
    email: r.email,
    domain: r.domain || null,
    subdomain: r.subdomain || null,
    local_part: r.local_part || null,
    status: r.status || null,
    created_at: r.created_at || null,
    // 'auto-inbound' = 收信时自动建的；其它（含 null）= 经 /admin/new_address 手动建的。
    // 暴露出来是为了能一眼分清来源，日后要清理自动建的垃圾信箱也能按它筛。
    fingerprint: r.fingerprint || null,
    label: r.label || null,
    group: r.group_name || null,
    message_count: Number(r.message_count || 0),
    last_mail_at: r.last_mail_at || null,
    last_code: r.last_code || null,
    last_code_at: r.last_code_at || null,
  }));

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mailboxes`
  ).first();

  return json({ ok: true, results, total: Number(totalRow?.n || 0) });
}

// POST /admin/mailboxes/meta
// 编辑真实信箱的备注与分组。邮箱地址是不可变主键；改地址应新建另一个信箱。
if (request.method === "POST" && url.pathname === "/admin/mailboxes/meta") {
  const body = await readBody(request);
  const token = extractAdminToken(request, body, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@") || /[\r\n]/.test(email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }

  const cleanMeta = (value, maxLength) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
    return cleaned ? cleaned.slice(0, maxLength) : null;
  };
  const label = cleanMeta(body?.label, 160);
  const group = cleanMeta(body?.group, 80);

  const mailbox = await env.DB.prepare(
    `SELECT id, email FROM mailboxes WHERE lower(email) = ? LIMIT 1`,
  ).bind(email).first();
  if (!mailbox) {
    return json({ ok: false, error: "Mailbox not found" }, 404);
  }

  await env.DB.prepare(
    `UPDATE mailboxes SET label = ?, group_name = ? WHERE id = ?`,
  ).bind(label, group, mailbox.id).run();

  return json({
    ok: true,
    mailbox: { email: mailbox.email, label, group },
  });
}

// GET /admin/messages/recent?limit=&offset=&q=&only_codes=&group=
// **跨全部信箱**按时间倒序的信息流。原来只有 /api/messages/latest（只回 1 封）
// 和 /admin/mails（必须带地址），统一收件箱因此只能靠猜地址扇出。
// LEFT JOIN：mailbox 已被删或历史上落进 inbox_test 的孤儿消息也要出现，不静默吞掉。
// group：去掉首尾空白后按 mailboxes.group_name 精确匹配；为空则不过滤。
// 指定 group 时孤儿消息（mb 为 NULL）自然不会命中——它们不属于任何分组。
if (request.method === "GET" && url.pathname === "/admin/messages/recent") {
  const token = extractAdminToken(request, {}, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }

  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const group = (url.searchParams.get("group") || "").trim();
  const onlyCodes = url.searchParams.get("only_codes") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const conds = [];
  const binds = [];
  if (onlyCodes) {
    conds.push("m.code IS NOT NULL AND m.code <> ''");
  }
  if (q) {
    conds.push("(lower(m.subject) LIKE ? OR lower(m.mail_from) LIKE ? OR lower(mb.email) LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (group) {
    conds.push("mb.group_name = ?");
    binds.push(group);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  binds.push(limit, offset);

  // ⚠️ 列表端点**只回摘要，不回完整正文**。
  // 邮件 HTML 可能达到几十 KB，列表接口只返回摘要以控制响应大小。
  // 完整正文走 /admin/message?id= 单封取。
  const rows = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.mail_from, m.subject,
            substr(m.text_body, 1, 400) AS text_body,
            substr(m.html_body, 1, 400) AS html_body,
            m.code, m.link, m.received_at,
            mb.email AS mailbox_email
       FROM messages m
       LEFT JOIN mailboxes mb ON mb.id = m.mailbox_id
       ${where}
      ORDER BY m.received_at DESC
      LIMIT ? OFFSET ?`
  ).bind(...binds).all();

  const results = (rows?.results || []).map((row) => {
    const mapped = mapMessageRow(row);
    // mailbox_email 为空 = 这封信当年落在了不存在的信箱（历史 inbox_test 兜底），
    // 收件人已不可考。显式回 null，让调用方知道是「未知收件人」而不是漏了字段。
    // body_truncated 明说正文是截断的，避免调用方拿它当完整内容缓存起来。
    return { ...mapped, mailbox_email: row.mailbox_email || null, body_truncated: true };
  });

  return json({ ok: true, results });
}

// GET /admin/message?id=<message_id>
// 取**单封**邮件的完整内容（正文 text + html + 验证码 + 链接 + 收件人）。
// 为什么不复用 /admin/messages/recent：详情页要能打开任意历史邮件，
// 而 recent 只有最近一窗；按 id 直取也更省。
if (request.method === "GET" && url.pathname === "/admin/message") {
  const token = extractAdminToken(request, {}, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }

  const id = (url.searchParams.get("id") || "").trim();
  if (!id) {
    return json({ ok: false, error: "Missing id" }, 400);
  }

  const row = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.mail_from, m.subject, m.text_body, m.html_body,
            m.code, m.link, m.received_at, m.message_id, m.in_reply_to, m.references_header,
            mb.email AS mailbox_email
       FROM messages m
       LEFT JOIN mailboxes mb ON mb.id = m.mailbox_id
      WHERE m.id = ?
      LIMIT 1`
  ).bind(id).first();

  if (!row) {
    return json({ ok: false, error: "Message not found" }, 404);
  }

  const inlineImages = await loadInlineImages(env, id);
  return json({
    ok: true,
    message: {
      ...mapMessageRow(row),
      mailbox_email: row.mailbox_email || null,
      inline_images: inlineImages,
    },
  });
}

// GET /admin/sending/status
// 发件能力与可选发件地址。只有同时存在 EMAIL binding 与已启用发件的域名才算可用。
if (request.method === "GET" && url.pathname === "/admin/sending/status") {
  const token = extractAdminToken(request, {}, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }
  return json({ ok: true, ...(await getSendingStatus(env)) });
}

// POST /admin/send
// 只允许从 D1 中真实存在、且域名已显式启用发件的 MailHub 信箱发送。
if (request.method === "POST" && url.pathname === "/admin/send") {
  const body = await readBody(request);
  const token = extractAdminToken(request, body, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }
  try {
    const sent = await sendDomainMail(env, body);
    return json({ ok: true, message: sent });
  } catch (error) {
    if (error instanceof SendMailError) {
      return json({ ok: false, error: error.message, code: error.code }, error.status);
    }
    throw error;
  }
}

// GET /admin/domains
// 暴露 domains 表里启用的根域，调用方据此判断「一个地址算不算我们家的」，
// 不必硬编码后缀（硬编码会漏掉子域名，例如 x@mail.example.com）。
if (request.method === "GET" && url.pathname === "/admin/domains") {
  const token = extractAdminToken(request, {}, url);
  if (!isAdminAuthorized(token, env)) {
    return json({ ok: false, error: "Invalid admin token" }, 401);
  }

  const rows = await env.DB.prepare(
    `SELECT domain, enabled FROM domains ORDER BY domain`
  ).all();

  const all = (rows?.results || []).filter(Boolean);
  const enabled = all
    .filter((r) => r.enabled === 1 || r.enabled === true || r.enabled === "1")
    .map((r) => String(r.domain || "").trim().toLowerCase())
    .filter(Boolean);

  return json({ ok: true, domains: enabled, total: all.length });
}

return json({ ok: false, error: "Not found" }, 404);

} catch (error) {

return json({ ok: false, error: String(error) }, 500);

}

}

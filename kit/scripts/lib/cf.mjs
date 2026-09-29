// Cloudflare REST 只读查询（wrangler 没有 JSON 输出的那几项）。改动类操作一律走 wrangler 命令。
// 令牌来自 `wrangler auth token --json`：用户浏览器授权过一次即可，过期由 wrangler 自动刷新。
import { EXIT, StepError, parseJsonLoose, wrangler } from "./common.mjs";

// 以下三个 MAILHUB_TEST_* 只给离线编排测试用（把 Cloudflare 换成本地假服务），正常使用不设。
const API = process.env.MAILHUB_TEST_CF_API || "https://api.cloudflare.com/client/v4";
const DOH_LIST = process.env.MAILHUB_TEST_DOH
  ? [process.env.MAILHUB_TEST_DOH]
  : ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];
const REWRITE = JSON.parse(process.env.MAILHUB_TEST_REWRITE || "{}"); // { "https://mail.x.test": "http://127.0.0.1:1234" }

let dispatcher;
async function proxyDispatcher() {
  // 国内网络常靠代理环境变量出网；Node 自带 fetch 默认不读它们，wrangler 用的是 undici 的同款逻辑。
  const hasProxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    .some((k) => process.env[k]);
  if (!hasProxy) return undefined;
  if (dispatcher === undefined) {
    try {
      const undici = await import("undici");
      dispatcher = { agent: new undici.EnvHttpProxyAgent(), fetch: undici.fetch };
    } catch {
      dispatcher = null; // 依赖还没装（doctor 阶段）：退回 Node 自带 fetch
    }
  }
  return dispatcher || undefined;
}

/** 与 fetch 同参；有代理环境变量时走代理。 */
export async function fetchx(url, init = {}) {
  for (const [from, to] of Object.entries(REWRITE)) {
    if (String(url).startsWith(from)) url = to + String(url).slice(from.length);
  }
  const d = await proxyDispatcher();
  const impl = d ? d.fetch : fetch;
  return impl(url, { signal: AbortSignal.timeout(30_000), ...init, ...(d && { dispatcher: d.agent }) });
}

export function authToken() {
  const res = wrangler(["auth", "token", "--json"]);
  if (res.code !== 0) return null;
  try {
    return parseJsonLoose(res.stdout).token || null;
  } catch {
    return null;
  }
}

async function cfRequest(method, pathname, body, token = authToken()) {
  if (!token) {
    throw new StepError("还没有登录 Cloudflare", { code: EXIT.FAIL, next: "node kit/scripts/setup.mjs login" });
  }
  let res;
  try {
    res = await fetchx(API + pathname, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new StepError(`连不上 Cloudflare 接口：${e.cause?.code || e.message}`, {
      next: "检查网络；国内网络如需代理，请在当前终端设置 HTTPS_PROXY 后重跑",
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = (data.errors || []).map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${res.status}`;
    const err = new StepError(`Cloudflare 接口 ${method} ${pathname} 返回错误：${msg}`);
    err.status = res.status;
    throw err;
  }
  return data.result;
}

export const cfGet = (pathname, token) => cfRequest("GET", pathname, undefined, token);
export const cfPut = (pathname, body, token) => cfRequest("PUT", pathname, body, token);

/** 按名字找 zone：返回 null 表示这个账号里没有该域名。 */
export async function findZone(domain, accountId) {
  const q = new URLSearchParams({ name: domain });
  if (accountId) q.set("account.id", accountId);
  const zones = await cfGet(`/zones?${q}`);
  return zones?.[0] || null;
}

export const routingSettings = (zoneId) => cfGet(`/zones/${zoneId}/email/routing`);
export const catchAllRule = (zoneId) => cfGet(`/zones/${zoneId}/email/routing/rules/catch_all`);

/** 兜底规则 → 交给 Worker。wrangler 4.142 的 `rules update catch-all` 只接受 forward/drop，所以直接调 REST。 */
export const setCatchAllToWorker = (zoneId, worker) => cfPut(`/zones/${zoneId}/email/routing/rules/catch_all`, {
  name: "MailHub catch-all",
  enabled: true,
  matchers: [{ type: "all" }],
  actions: [{ type: "worker", value: [worker] }],
});

/** 某个主机名当前绑定在哪个 Worker 上（Workers 自定义域名）；没绑定返回 null。 */
export async function workerDomainOf(accountId, hostname) {
  const list = await cfGet(`/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`);
  return (list || []).find((d) => d.hostname === hostname) || null;
}

/** 账号里已有的 Worker 名字。 */
export async function workerNames(accountId) {
  const list = await cfGet(`/accounts/${accountId}/workers/scripts`);
  return new Set((list || []).map((w) => w.id));
}

/**
 * 公共 DoH 查记录。两个解析器依次尝试；都失败或返回错误状态时抛错 ——
 * 「查不到」绝不能当成「没有记录」，否则会把用户在用的邮箱 / 网站误判成空闲。
 */
export async function lookupDns(name, type) {
  const resolvers = DOH_LIST.map((base) => `${base}?name=${encodeURIComponent(name)}&type=${type}`);
  const errors = [];
  for (const url of resolvers) {
    try {
      const res = await fetchx(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(15_000) });
      const body = await res.json();
      // Status 0 = NOERROR，3 = NXDOMAIN（名字不存在，等于没有记录）；其它都是查询失败。
      if (body.Status === 0 || body.Status === 3) {
        return (body.Answer || []).map((a) => ({ type: a.type, data: String(a.data).replace(/\.$/, "").toLowerCase() }));
      }
      errors.push(`${new URL(url).host} Status=${body.Status}`);
    } catch (e) {
      errors.push(`${new URL(url).host} ${e.cause?.code || e.message}`);
    }
  }
  throw new StepError(`查询 ${name} 的 ${type} 记录失败（${errors.join("；")}）`);
}

export async function lookupMx(domain) {
  return (await lookupDns(domain, "MX")).filter((a) => a.type === 15).map((a) => a.data.split(/\s+/).pop());
}

/** Cloudflare Email Routing 自己的 MX 主机。 */
export const isCloudflareMx = (host) => /(^|\.)mx\.cloudflare\.net$/.test(host);

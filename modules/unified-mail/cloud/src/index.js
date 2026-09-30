/**
 * 云端域名邮箱界面的网关 Worker。
 *
 * 它同时干三件事：
 *   1. 同源提供前端静态资源（SPA，未命中路径回 index.html）
 *   2. 账号密码登录 → 签名 Cookie 会话
 *   3. 已登录时，把 /admin/* 与 /api/* **代理**给 CFMail，并在服务端注入两把密钥
 *
 * 为什么这么设计（相对「浏览器直连 CFMail」的旧方案）：
 *   · 密钥**彻底不进浏览器** —— 存在 Worker 的加密环境变量里，前端永远拿不到；
 *   · 同源，不需要 CORS；
 *   · 用户只记一个账号密码，换设备直接登录，不用背两串 40+ 字符的 token。
 *
 * 环境变量（都用 `wrangler secret put` 设，加密存储、面板不可见）：
 *   APP_USER              登录用户名
 *   APP_PASSWORD          登录密码
 *   SESSION_SECRET        给会话 Cookie 签名用的随机串
 *   CFMAIL_BASE_URL       默认 https://api-mail.example.com（可用普通变量）
 *   CFMAIL_ADMIN_TOKEN    CFMail 的 /admin/* 密钥
 *   CFMAIL_SITE_PASSWORD  CFMail 的 /api/* 密钥
 *
 * 本地免登录（`wrangler dev` 在本机跑同一个网关时用）：
 *   LOCAL_NO_LOGIN=1      只写在本地 `.dev.vars` 里（deploy 不上传它），且只对
 *                         127.0.0.1 / localhost 的请求生效 —— 线上即使误设也不会放行。
 *                         此时只需要两把 CFMAIL 密钥，不需要登录三件套。
 */

import { checkLoginRateLimit } from "./login-rate-limit.mjs";

const COOKIE = "mh_session";
const SESSION_HOURS = 24 * 14; // 两周免登录；过期只需重新输一次

/* ── 工具 ───────────────────────────────────────────────── */

const enc = new TextEncoder();

/** 定长比较，避免用比较耗时反推密码。 */
function safeEqual(a, b) {
  const x = enc.encode(String(a ?? ""));
  const y = enc.encode(String(b ?? ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** 会话令牌 = `<过期时间戳>.<签名>`。无状态，不需要任何存储。 */
async function issueSession(env) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
}

async function verifySession(env, token) {
  if (!token || !token.includes(".")) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, expStr));
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", ...headers },
  });

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** 本地免登录：开关 + 回环地址，两个条件缺一不可。 */
function localNoLogin(env, url) {
  return env.LOCAL_NO_LOGIN === "1" && LOOPBACK_HOSTS.has(url.hostname);
}

function configured(env, url) {
  const cfmail = Boolean(env.CFMAIL_ADMIN_TOKEN && env.CFMAIL_SITE_PASSWORD);
  if (localNoLogin(env, url)) return cfmail;
  return Boolean(env.APP_USER && env.APP_PASSWORD && env.SESSION_SECRET && cfmail);
}

/**
 * 本地免登录时挡跨站写请求：别的网页可以让浏览器向 127.0.0.1 提交表单（CSRF），
 * 而本地模式不校验登录，这类请求会带着服务端密钥被转发出去。
 * 只放行同源页面、或不带 Origin 的非浏览器客户端（curl 等）。GET 读不到跨站响应，不受影响。
 */
function localWriteAllowed(request, url) {
  if (["GET", "HEAD"].includes(request.method)) return true;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return LOOPBACK_HOSTS.has(o.hostname) && o.port === url.port;
  } catch {
    return false;
  }
}

async function authed(request, env, url) {
  if (localNoLogin(env, url)) return true;
  return verifySession(env, readCookie(request, COOKIE));
}

function cloudWriteAllowed(request, url) {
  if (["GET", "HEAD"].includes(request.method)) return true;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

/* ── 代理到 CFMail ──────────────────────────────────────── */

async function proxyToCfmail(request, env, url) {
  const base = (env.CFMAIL_BASE_URL || "https://api-mail.example.com").replace(/\/+$/, "");
  const target = new URL(base + url.pathname + url.search);

  // /admin/* 走 x-admin-auth 头；/api/* 走 password query —— 两把密钥不通用，
  // 且**都由服务端注入**，浏览器永远看不到它们。
  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  if (url.pathname.startsWith("/admin/")) {
    headers.set("x-admin-auth", env.CFMAIL_ADMIN_TOKEN);
  } else {
    target.searchParams.set("password", env.CFMAIL_SITE_PASSWORD);
  }

  const init = { method: request.method, headers };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();

  const upstream = await fetch(target.toString(), init);
  // 原样透传状态码与内容；不回显任何凭据
  const out = new Headers();
  const upCt = upstream.headers.get("content-type");
  if (upCt) out.set("content-type", upCt);
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* ── 入口 ───────────────────────────────────────────────── */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 没配好密钥时给出明确指引，而不是让用户对着 500 猜
    if (!configured(env, url) && url.pathname.startsWith("/auth/")) {
      return json({
        ok: false,
        error: "服务端尚未配置：需要设置 APP_USER / APP_PASSWORD / SESSION_SECRET / " +
               "CFMAIL_ADMIN_TOKEN / CFMAIL_SITE_PASSWORD 这几个 secret",
      }, 503);
    }

    // ── 登录状态 ──
    if (url.pathname === "/auth/status") {
      const ok = await authed(request, env, url);
      return json({ authed: ok, configured: configured(env, url),
                    local: localNoLogin(env, url) }, 200,
                  { "cache-control": "no-store" });
    }

    // ── 登录 ──
    if (url.pathname === "/auth/login" && request.method === "POST") {
      if (!localNoLogin(env, url)) {
        try {
          const retryAfter = await checkLoginRateLimit(request, env);
          if (retryAfter) {
            return json({ ok: false, code: "LOGIN_RATE_LIMITED", retry_after: retryAfter,
              error: "登录尝试过于频繁，请稍后再试" }, 429,
            { "retry-after": String(retryAfter), "cache-control": "no-store" });
          }
        } catch {
          // Fail closed if shared protection cannot be checked.
          return json({ ok: false, code: "LOGIN_PROTECTION_UNAVAILABLE",
            error: "登录保护暂不可用，请稍后重试" }, 503, { "cache-control": "no-store" });
        }
      }
      let body = {};
      try { body = await request.json(); } catch { /* 非 JSON 当空处理 */ }

      // 用户名**忽略大小写**并去掉首尾空格：它是个邮箱地址，本来就不区分大小写，
      // 手机键盘还爱自动首字母大写 —— 没理由让人卡在这种地方。
      // 密码**严格区分大小写**，且不 trim（空格可能是密码的一部分）。
      // 两者都用定长比较；失败信息统一，不区分「用户不存在」与「密码错」，
      // 免得帮攻击者做用户名枚举。
      const normUser = (s) => String(s ?? "").trim().toLowerCase();
      const ok = safeEqual(normUser(body?.username), normUser(env.APP_USER)) &&
                 safeEqual(body?.password, env.APP_PASSWORD);
      if (!ok) {
        // Small supplementary delay; the shared counter above enforces the limit.
        await new Promise((r) => setTimeout(r, 600));
        return json({ ok: false, error: "用户名或密码不对" }, 401);
      }

      const token = await issueSession(env);
      return json({ ok: true }, 200, {
        "set-cookie":
          `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
          `Max-Age=${SESSION_HOURS * 3600}`,
        "cache-control": "no-store",
      });
    }

    // ── 登出 ──
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return json({ ok: true }, 200, {
        "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        "cache-control": "no-store",
      });
    }

    // ── 数据接口：必须已登录 ──
    if (url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/")) {
      if (!(await authed(request, env, url))) {
        return json({ ok: false, error: "未登录" }, 401, { "cache-control": "no-store" });
      }
      if (localNoLogin(env, url) && !localWriteAllowed(request, url)) {
        return json({ ok: false, error: "拒绝跨站请求" }, 403, { "cache-control": "no-store" });
      }
      if (!localNoLogin(env, url) && !cloudWriteAllowed(request, url)) {
        return json({ ok: false, error: "拒绝跨站请求" }, 403, { "cache-control": "no-store" });
      }
      return proxyToCfmail(request, env, url);
    }

    // ── 其余交给静态资源（SPA 回退由 assets 配置负责）──
    return env.ASSETS.fetch(request);
  },
};

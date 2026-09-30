// 用户问询结果（.mailhub/config.json）的校验，以及由它派生出的资源名与 wrangler 配置。
import path from "node:path";

import {
  CONFIG_FILE, EXIT, FRONTEND_DIR, GATEWAY_DIR, GEN_DIR, MIGRATIONS_DIR, StepError, WORKER_DIR,
  readJson, writeJson,
} from "./common.mjs";

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PREFIX_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** 问询模板：SKILL.md 让 agent 把用户回答填进这些字段。 */
export const CONFIG_TEMPLATE = {
  domain: "example.com",
  web_host: "mail.example.com",
  api_host: "api-mail.example.com",
  login_user: "you@gmail.com",
  attachments: false,
  prefix: "mailhub",
};

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\.$/, "");

export function validateConfig(raw) {
  const errors = [];
  // 模板只用于展示字段；地址类不能拿模板值兜底（没填 api_host 时要派生成 api-mail.<域名>）。
  const cfg = { attachments: false, prefix: "mailhub", ...raw };
  cfg.domain = norm(cfg.domain);
  cfg.web_host = norm(cfg.web_host);
  cfg.api_host = norm(cfg.api_host) || `api-mail.${cfg.domain}`;
  cfg.login_user = String(cfg.login_user ?? "").trim();
  cfg.prefix = norm(cfg.prefix) || "mailhub";
  cfg.attachments = cfg.attachments === true;

  if (!HOST_RE.test(cfg.domain)) errors.push(`domain「${cfg.domain}」不是合法域名（例：example.com）`);
  for (const key of ["web_host", "api_host"]) {
    const host = cfg[key];
    if (!HOST_RE.test(host)) errors.push(`${key}「${host}」不是合法地址`);
    else if (!host.endsWith("." + cfg.domain)) {
      // 必须是子域名：用根域本身会顶掉用户已有的网站。
      errors.push(`${key}「${host}」必须是 ${cfg.domain} 下的子域名（例：mail.${cfg.domain}）`);
    }
  }
  if (cfg.web_host && cfg.web_host === cfg.api_host) errors.push("web_host 和 api_host 不能相同");
  if (!cfg.login_user) errors.push("login_user（登录用户名）不能为空");
  if (!PREFIX_RE.test(cfg.prefix)) errors.push(`prefix「${cfg.prefix}」只能是小写字母、数字、连字符（3–32 位）`);
  if (cfg.domain === "example.com") errors.push("domain 还是模板里的 example.com，请换成你的域名");

  if (errors.length) {
    throw new StepError("配置有问题：\n  - " + errors.join("\n  - "), {
      code: EXIT.BAD_INPUT,
      next: `修正后重跑（init 的参数，或直接改 ${CONFIG_FILE}）`,
    });
  }
  return cfg;
}

export function loadConfig() {
  const raw = readJson(CONFIG_FILE);
  if (!raw) {
    throw new StepError(`还没有配置文件 ${CONFIG_FILE}`, {
      code: EXIT.BAD_INPUT,
      next: "先按 SKILL.md 第 4 节问询用户，再执行：node kit/scripts/setup.mjs init --domain ... --web-host ... --login-user ...",
    });
  }
  return validateConfig(raw);
}

export function saveConfig(cfg) {
  writeJson(CONFIG_FILE, validateConfig(cfg));
}

/** 所有 Cloudflare 资源名都由前缀派生，同一账号里可以并存多套。 */
export function names(cfg) {
  const p = cfg.prefix;
  return {
    db: `${p}-db`,
    bucket: `${p}-attachments`,
    inbox: `${p}-inbox`,
    api: `${p}-api`,
    web: `${p}-web`,
  };
}

const rel = (to) => path.relative(GEN_DIR, to).split(path.sep).join("/");
const COMPAT_DATE = "2026-08-17";

/** 生成三份 wrangler 配置（JSON 是合法 JSONC）。只含非敏感值；密钥一律走 secret。 */
export function wranglerConfigs(cfg, { databaseId }) {
  const n = names(cfg);
  const d1 = [{ binding: "DB", database_name: n.db, database_id: databaseId || "00000000-0000-0000-0000-000000000000", migrations_dir: rel(MIGRATIONS_DIR) }];
  const r2 = cfg.attachments ? [{ binding: "ATTACHMENTS", bucket_name: n.bucket }] : undefined;
  const observability = { enabled: true, head_sampling_rate: 1 };

  const inbox = {
    name: n.inbox,
    main: rel(path.join(WORKER_DIR, "src", "mail-inbox.js")),
    compatibility_date: COMPAT_DATE,
    workers_dev: false,
    d1_databases: d1,
    ...(r2 && { r2_buckets: r2 }),
    observability,
  };
  const api = {
    name: n.api,
    main: rel(path.join(WORKER_DIR, "src", "mail-api.js")),
    compatibility_date: COMPAT_DATE,
    workers_dev: false,
    routes: [{ pattern: cfg.api_host, custom_domain: true }],
    d1_databases: d1,
    ...(r2 && { r2_buckets: r2 }),
    vars: { CORS_ORIGINS: `https://${cfg.web_host}` },
    observability,
  };
  const web = {
    name: n.web,
    main: rel(path.join(GATEWAY_DIR, "src", "index.js")),
    compatibility_date: "2026-07-01",
    workers_dev: false,
    d1_databases: d1,
    routes: [{ pattern: cfg.web_host, custom_domain: true }],
    assets: {
      directory: rel(path.join(FRONTEND_DIR, "dist-cloud")),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
    },
    vars: { CFMAIL_BASE_URL: `https://${cfg.api_host}` },
    observability,
  };
  // 本地版专用：去掉 routes。带 routes 时 wrangler dev 会把请求 URL 改写成线上域名，
  // 网关就认不出这是本机请求，免登录开关不会生效。
  const { routes: _drop, ...webLocal } = web;
  return { inbox, api, web, "web-local": webLocal };
}

export const configPath = (which) => path.join(GEN_DIR, `wrangler.${which}.json`);

/**
 * 登录密码的问题描述；没问题返回 null。
 * 首尾空白一律拒绝：`wrangler secret put` 会去掉结尾空白，而网关严格比对，存进去就再也登不上。
 */
export function passwordProblem(pw) {
  if (pw.length < 8) return "至少 8 位";
  if (pw !== pw.trim()) return "开头和结尾不能有空格";
  return null;
}

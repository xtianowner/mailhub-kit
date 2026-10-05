// 云端版数据层：**同源**调网关 Worker，密钥完全不进浏览器。
//
// 早先的设计是浏览器直连 CFMail、把两把密钥存 localStorage —— 那要求用户在每台
// 设备上背两串 40+ 字符的 token，页面还得跨域。现在改成：
//
//   浏览器 ──登录(账号+密码)──▶ mail Worker ──服务端注入密钥──▶ CFMail
//
// 于是：密钥只活在 Worker 的加密环境变量里、同源无需 CORS、用户只记一个账号密码。
// 网关实现见 modules/unified-mail/cloud/src/index.js。
//
// 输出形状与本地版 hubApi 对齐，页面组件两个目标通用。
import { translate } from '../i18n/LocaleProvider.jsx'

export class CfError extends Error {
  constructor(message, status, kind, retryAfter = 0) {
    super(message)
    this.name = 'CfError'
    this.status = status
    this.kind = kind || (status === 401 ? 'unauthorized' : 'other')
    this.retryAfter = retryAfter
  }

  get userMessage() {
    // 取值那一刻的界面语言；服务端回的错误原文（this.message）原样透出
    if (this.status === 401) return translate('err.sessionExpired')
    if (this.status === 503) return translate('err.serverKeysMissing')
    if (this.status === 0) return translate('err.network.cloud')
    if (this.status === 404) return translate('err.notFound')
    return this.message || translate('err.http', { status: this.status })
  }
}

const qs = (params) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function call(path, { params = {}, method = 'GET', body } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(path + qs(params), opts)
  } catch {
    throw new CfError('network', 0)
  }
  if (!res.ok) {
    let detail = ''
    let code = ''
    let retryAfter = Number(res.headers.get('retry-after')) || 0
    try {
      const error = await res.json()
      detail = error?.error || ''
      code = error?.code || ''
      retryAfter = Number(error?.retry_after) || retryAfter
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new CfError(detail, res.status, code || undefined, retryAfter)
  }
  return res.json()
}

/* ── 归一：CFMail 的行 → 与本地版相同的形状 ─────────────────── */
function toMessage(r, mailboxFallback = '') {
  const text = r.text || r.text_body || ''
  const html = r.html || r.html_body || ''
  const truncated = Boolean(r.body_truncated)
  return {
    source: 'domain',
    mailbox: r.mailbox_email || mailboxFallback || translate('md.unknownRecipient'),
    message_id: String(r.id || ''),
    subject: r.subject || null,
    from_name: null,
    from_address: r.mail_from || null,
    received_at: r.received_at || null,
    preview: r.preview || (text ? text.slice(0, 200) : null),
    code: r.code || null,
    links: r.link ? [r.link] : [],
    folder: null,
    account_id: null,
    // 列表端点回的是截断正文，绝不能当全文用（详情走 /admin/message 重取）
    text_body: truncated ? null : text || null,
    html_body: truncated ? null : html || null,
    inline_images: r.inline_images || [],
  }
}

function toMailbox(r) {
  return {
    source: 'domain',
    email: r.email,
    label: r.label || null,
    group: r.group || r.group_name || null,
    last_mail_at: r.last_mail_at || null,
    last_code: r.last_code || null,
    last_code_at: r.last_code_at || null,
    status: r.fingerprint === 'auto-inbound' ? 'auto' : 'discovered',
    account_id: null,
    is_alias: false,
    message_count: r.message_count ?? null,
  }
}

/* ── 登录 ─────────────────────────────────────────────────── */
export const cloudAuth = {
  status: () => call('/auth/status'),
  login: (username, password) =>
    call('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => call('/auth/logout', { method: 'POST' }),
}

/* ── 与本地版 hubApi 同名的数据接口 ───────────────────────── */
export const cfApi = {
  receivingSettings: () => call('/admin/settings/receiving'),
  saveReceivingSettings: (receive_mode) =>
    call('/admin/settings/receiving', { method: 'POST', body: { receive_mode } }),
  async health() {
    try {
      const d = await call('/admin/domains')
      const domains = d.domains || []
      return {
        upstreams: [{ source: 'domain', ok: true, base: 'CFMail', domains: domains.length }],
        domain_suffixes: domains,
        worker_discovery: true,
      }
    } catch (err) {
      return {
        upstreams: [{ source: 'domain', ok: false, base: 'CFMail', detail: err.userMessage }],
        domain_suffixes: [],
        worker_discovery: false,
      }
    }
  },

  async domainList() {
    try {
      return (await call('/admin/domains')).domains || []
    } catch {
      return []
    }
  },

  async domains() {
    const doms = await cfApi.domainList()
    return { domains: doms, cfmail_configured: true, worker_discovery: true }
  },

  async summary() {
    const [boxes, doms, recent] = await Promise.all([
      cfApi.mailboxes({ limit: 1000 }).catch(() => ({ rows: [] })),
      cfApi.domainList(),
      cfApi.inbox({ limit: 50 }).catch(() => ({ rows: [] })),
    ])
    return {
      hotmail: { available: false, accounts: 0, ok: 0, expiring: 0, expired: 0, dead: 0 },
      domain: { available: true, mailboxes: boxes.rows.length, suffixes: doms },
      recent_count: recent.rows.length,
      recent_with_code: recent.rows.filter((r) => r.code).length,
    }
  },

  // 统一总览「邮箱信息」区一次要的全部数据，每类只取一次（形状与本地版 hubApi.overview 一致）：
  // 域名列表 / 信箱列表 / 最近 50 封（算「最近邮件、其中带验证码」）。健康状态由域名列表能否取到推出，
  // 分组名与每个域名的信箱数都从同一份信箱列表里算，不再为分组或汇总另拉信箱列表。
  async overview() {
    const [doms, boxes, recent] = await Promise.all([
      call('/admin/domains').then((d) => ({ ok: true, list: d.domains || [] }), (err) => ({ ok: false, err })),
      cfApi.mailboxes({ limit: 1000 }).catch(() => null),
      cfApi.inbox({ limit: 50 }).catch(() => null),
    ])
    const domains = doms.ok ? doms.list : []
    const rows = boxes?.rows || []
    return {
      health: {
        upstreams: [
          doms.ok
            ? { source: 'domain', ok: true, base: 'CFMail', domains: domains.length }
            : { source: 'domain', ok: false, base: 'CFMail', detail: doms.err?.userMessage },
        ],
        domain_suffixes: domains,
        worker_discovery: doms.ok,
      },
      summary: {
        hotmail: { available: false, accounts: 0, ok: 0, expiring: 0, expired: 0, dead: 0 },
        domain: { available: true, mailboxes: boxes ? rows.length : null, suffixes: domains },
        recent_count: recent ? recent.rows.length : null,
        recent_with_code: recent ? recent.rows.filter((r) => r.code).length : null,
      },
      hotmailGroups: [],
      domainBoxes: boxes ? rows : null,
      domains,
    }
  },

  // group：按信箱分组名筛选（mail-api 去首尾空白后精确匹配；网关原样转发查询串）
  async inbox({ limit = 50, q, only_codes, group } = {}) {
    const d = await call('/admin/messages/recent', {
      params: { limit, q, only_codes: only_codes ? 'true' : undefined, group },
    })
    const rows = (d.results || []).map((r) => toMessage(r))
    return { rows, count: rows.length }
  },

  async message({ id }) {
    const d = await call('/admin/message', { params: { id } })
    if (!d.message) throw new CfError(translate('err.messageNotFound'), 404)
    return toMessage(d.message)
  },

  async code(email) {
    try {
      const d = await call('/api/mailboxes/code', { params: { email } })
      const msg = d.latest_message || d.message || null
      return {
        source: 'domain',
        email,
        found: Boolean(d.code),
        code: d.code || null,
        received_at: msg?.received_at || null,
        subject: msg?.subject || null,
        links: msg?.link ? [msg.link] : [],
        error: null,
        message: msg ? toMessage(msg, email) : null,
      }
    } catch (err) {
      if (err.status === 404) {
        return {
          source: 'domain', email, found: false, code: null, links: [],
          error: translate('code.notReceivedYet.cloud'),
          message: null,
        }
      }
      return {
        source: 'domain', email, found: false, code: null, links: [],
        error: err.userMessage, message: null,
      }
    }
  },

  async mailboxes({ q, limit = 1000 } = {}) {
    const d = await call('/admin/mailboxes', { params: { q, limit } })
    const rows = (d.results || []).map(toMailbox)
    return { rows, count: rows.length, total: d.total, truncated: rows.length >= limit }
  },

  async createMailbox({ name, domain, label, group }) {
    const d = await call('/admin/new_address', { method: 'POST', body: { name, domain } })
    if (!d.email && !d.address) throw new CfError(translate('err.createNoEmail'), 500)
    const email = d.email || d.address
    if (label || group) {
      await call('/admin/mailboxes/meta', {
        method: 'POST',
        body: { email, label, group },
      })
    }
    return { id: d.id, email, domain: d.domain || domain }
  },

  async setMailboxMeta(email, { label, group } = {}) {
    return call('/admin/mailboxes/meta', {
      method: 'POST',
      body: { email, label, group },
    })
  },

  async sendingStatus() {
    return call('/admin/sending/status')
  },

  async sendDomainMail({ from_address, to, subject, text, reply_to_message_id }) {
    return call('/admin/send', {
      method: 'POST',
      body: { from: from_address, to, subject, text, reply_to_message_id },
    })
  },
}

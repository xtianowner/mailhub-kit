// 统一层 API 客户端。**两种构建目标共用同一套页面组件**：
//
//   本地版（默认）      → 调本机 mail-hub 后端 `/api/hub/*`，后端持有密钥
//   云端版（VITE_TARGET=cloud）→ 浏览器直连 CFMail，只做域名邮箱
//
// 切换做在这一层而不是每个页面里 —— 页面拿到的是同一个 `hubApi` 形状，
// 于是两个版本的界面天然同源，不会各自漂移。
import { qs, request } from './http.js'
import { cfApi } from './cfmailDirect.js'

export const IS_CLOUD = import.meta.env.VITE_TARGET === 'cloud'

// 云端版是纯静态站，没有本机注册表可写。
const notSupported = (what) => () =>
  Promise.reject(Object.assign(new Error(what), { userMessage: `云端版不支持${what}` }))

const localApi = {

  health: () => request('/api/hub/health'),
  summary: () => request('/api/hub/summary'),

  // 统一收件箱：两个来源归并的时间倒序信息流
  inbox: ({ limit, q, source, only_codes } = {}) =>
    request(`/api/hub/inbox${qs({ limit, q, source, only_codes })}`),

  // 统一接码：给地址，自动判定走 CFMail 还是 Graph
  code: (email, source = 'all') =>
    request('/api/hub/code', { method: 'POST', body: { email, source } }),

  // 单封邮件完整内容（没验证码的信也要能读全文）
  message: ({ source, id, account_id }) =>
    request(`/api/hub/message${qs({ source, id, account_id })}`),

  // 统一邮箱簿
  mailboxes: ({ q, source, limit } = {}) =>
    request(`/api/hub/mailboxes${qs({ q, source, limit })}`),
  groups: () => request('/api/hub/groups'),
  domains: () => request('/api/hub/domains'),
  sendingStatus: () => request('/api/hub/sending/status'),
  sendDomainMail: ({ from_address, to, subject, text, reply_to_message_id }) =>
    request('/api/hub/send', {
      method: 'POST',
      body: { from_address, to, subject, text, reply_to_message_id },
    }),

  // 域名信箱：真建（CFMail）/ 改备注 / 移出
  createMailbox: ({ name, domain, label, group }) =>
    request('/api/hub/mailboxes/create', { method: 'POST', body: { name, domain, label, group } }),
  setMailboxMeta: (email, { label, group } = {}) =>
    request(`/api/hub/mailboxes/${encodeURIComponent(email)}/meta`, {
      method: 'POST',
      body: { label, group },
    }),
  unregisterMailbox: (email) =>
    request(`/api/hub/mailboxes/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  supportsLocalRegistry: true,
}

// 云端版：补齐本地版有、云端没有的方法，让页面不用做 if 判断
const cloudApi = {
  ...cfApi,
  supportsLocalRegistry: false,
  // 云端版的密钥在网关 Worker 里，浏览器不持有 —— 不存在「还没填密钥」这种状态，
  // 未登录会被登录页拦在外面。
  groups: () => Promise.resolve({ groups: [] }),
  unregisterMailbox: notSupported('移出邮箱簿'),
}

export const hubApi = IS_CLOUD ? cloudApi : localApi

// 域名邮箱的「员工开通」那套 = team-admin 的既有 API，经统一层代理在 /api/domain/*。
// team-admin 没在跑时这些会回 503，页面按降级处理（不崩）。
export const domainApi = {
  status: () => request('/api/domain/status'),
  employees: () => request('/api/domain/employees'),
  employee: (id) => request(`/api/domain/employees/${id}`),
  employeeCodes: (id) => request(`/api/domain/employees/${id}/codes`),
  inboxCode: (email) => request(`/api/domain/inbox/code${qs({ email })}`),
  inboxMessages: (email, limit) => request(`/api/domain/inbox/messages${qs({ email, limit })}`),
}

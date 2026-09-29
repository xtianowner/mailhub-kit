// Hotmail 侧 API 客户端。统一层把 hotmail-graph 的全部端点透明代理在
// `/api/hotmail/*` 下，所以这里只是把原来的 `/api/*` 换了前缀，契约完全没变
// （见 modules/hotmail-graph/docs/api.md）。统一层自己的端点在 hubApi.js。
// 前端永远拿不到 refresh token —— 凭据只在 hotmail-graph 后端。
import { ApiError, qs, request } from './http.js'
import { IS_CLOUD } from './hubApi.js'
import { cloudAuth } from './cfmailDirect.js'

export const api = {
  summary: () => request('/api/hotmail/summary'),
  accounts: ({ q, bucket, group, page, page_size, sort } = {}) =>
    request(`/api/hotmail/accounts${qs({ q, bucket, group, page, page_size, sort })}`),
  account: (id) => request(`/api/hotmail/accounts/${id}`),
  // Distinct user-defined groups + per-group account counts (for the filter UI).
  groups: () => request('/api/hotmail/groups'),
  // Set/clear a per-account note + group tag. Omitted field = unchanged; '' = clear.
  setMeta: (id, { note, group } = {}) =>
    request(`/api/hotmail/accounts/${id}/meta`, { method: 'POST', body: { note, group } }),
  listAliases: (id) => request(`/api/hotmail/accounts/${id}/aliases`),
  // Global alias directory (paged + searchable by alias_email).
  aliases: ({ q, page, page_size } = {}) => request(`/api/hotmail/aliases${qs({ q, page, page_size })}`),
  aliasCode: (aliasId) => request(`/api/hotmail/aliases/${aliasId}/code`, { method: 'POST' }),
  deleteAccount: (id) => request(`/api/hotmail/accounts/${id}`, { method: 'DELETE' }),
  importAccounts: (text) => request('/api/hotmail/accounts/import', { method: 'POST', body: { text } }),
  refreshAccount: (id) => request(`/api/hotmail/accounts/${id}/refresh`, { method: 'POST' }),
  bulkRefresh: (kind) => request('/api/hotmail/bulk-refresh', { method: 'POST', body: { kind } }),
  bulkStatus: () => request('/api/hotmail/bulk-status'),
  getCode: (id) => request(`/api/hotmail/accounts/${id}/code`, { method: 'POST' }),
  // Verification-code history: cached messages on this account that carried a code.
  codeHistory: (id, top = 20) => request(`/api/hotmail/accounts/${id}/codes${qs({ top })}`),
  messages: (id, top = 20) => request(`/api/hotmail/accounts/${id}/messages${qs({ top })}`),
  message: (id, mid) => request(`/api/hotmail/accounts/${id}/messages/${mid}`),
  reextract: (id, mid) =>
    request(`/api/hotmail/accounts/${id}/messages/${mid}/reextract`, { method: 'POST' }),
  settings: () => request('/api/hotmail/settings'),
  saveSettings: (fields) => request('/api/hotmail/settings', { method: 'POST', body: fields }),
  // Auth gate — only matters when the backend has auth_enabled=true.
  // 鉴权三件套按构建目标分流：
  //   本地版 → /api/hub/*，可选的 HUB_API_TOKEN 门（默认不启用）
  //   云端版 → /auth/*，网关 Worker 的账号密码 + 签名 Cookie（始终启用）
  authStatus: () =>
    IS_CLOUD
      ? cloudAuth.status().then((d) => ({ auth_enabled: true, authed: !!d.authed }))
      : request('/api/hub/auth-status'),
  login: (creds) =>
    IS_CLOUD
      ? cloudAuth.login(creds.username, creds.password).then((d) => ({ authed: !!d.ok }))
      : request('/api/hub/login', { method: 'POST', body: { token: creds } }),
  logout: () => (IS_CLOUD ? cloudAuth.logout() : request('/api/hub/logout', { method: 'POST' })),
}

export { ApiError }

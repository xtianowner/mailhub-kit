// 共享 fetch 封装。api.js（hotmail 侧代理）与 hubApi.js（统一层）都用这一个，
// 保证鉴权头、错误形状、查询串拼法只有一处实现。
//
// 令牌：只在统一层设了 HUB_API_TOKEN 时才需要。存 localStorage，每个请求带
// Authorization。**这是访问令牌，不是邮箱凭据** —— 邮箱的 refresh token 永远只在后端。

const TOKEN_KEY = 'hub_token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  /** 给用户看的一句话（后端的 detail 优先，其次按状态码兜底）。 */
  get userMessage() {
    if (this.status === 0) return '连不上服务，确认 ./start.sh 已经跑起来'
    const d = this.body?.detail
    if (typeof d === 'string' && d) return d
    if (this.status === 401) return '未授权，请重新登录'
    if (this.status === 503) return '上游服务没在跑'
    return `请求失败（HTTP ${this.status}）`
  }
}

export async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} }
  const token = getToken()
  if (token) opts.headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(path, opts)
  } catch {
    throw new ApiError('network', 0, null)
  }
  let data = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status, data)
  return data
}

export const qs = (params) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

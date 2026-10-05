// Date/relative formatting + bucket→semantic-color mapping. Colors come from tokens
// (success/warning/danger/subtle) so both themes stay on-token.

export function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Relative "x ago" — compact, locale-aware via zh/en token strings passed in.
// now：可选的「现在」。列表按固定节拍传同一个 now，相对时间就不会在无关的重渲染里悄悄变化。
export function fmtRelative(iso, locale = 'zh', now = Date.now()) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sec = Math.round((now - d.getTime()) / 1000)
  const units = [
    [60, 'sec'],
    [3600, 'min'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [Infinity, 'month'],
  ]
  const labels = {
    zh: { sec: '秒前', min: '分钟前', hour: '小时前', day: '天前', month: '个月前', now: '刚刚' },
    en: { sec: 's ago', min: 'm ago', hour: 'h ago', day: 'd ago', month: 'mo ago', now: 'just now' },
  }
  const L = labels[locale] || labels.zh
  if (sec < 30) return L.now
  if (sec < 60) return `${sec}${L.sec}`
  let prev = 60
  for (const [limit, unit] of units) {
    if (sec < limit) {
      const div = unit === 'min' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : 86400 * 30
      return `${Math.round(sec / div)}${L[unit]}`
    }
    prev = limit
  }
  return fmtDate(iso)
}

// bucket → { text color class, dot/badge tint } — semantic tokens only.
export const BUCKET_TONE = {
  ok: 'success',
  expiring: 'warning',
  expired: 'danger',
  dead: 'danger',
  never: 'subtle',
}

export function bucketTone(bucket) {
  return BUCKET_TONE[bucket] || 'subtle'
}

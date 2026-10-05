/** 把搜索词在文本里高亮（不改原文大小写） */
export function Hl({ text, q }) {
  const needle = (q || '').trim()
  if (!needle || !text) return text || null
  const lower = text.toLowerCase()
  const n = needle.toLowerCase()
  let i = lower.indexOf(n)
  if (i < 0) return text
  const out = []
  let from = 0
  while (i >= 0) {
    if (i > from) out.push(text.slice(from, i))
    out.push(
      <mark key={i} className="mh-mark">
        {text.slice(i, i + n.length)}
      </mark>,
    )
    from = i + n.length
    i = lower.indexOf(n, from)
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

// 统一总览的数据层：邮箱信息（每类只取一次）+ 最近邮件时间线（筛选变化时重取、定时轮询只合并新行）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hubApi, IS_CLOUD } from '../../lib/hubApi.js'

const POLL_MS = 20_000 // 只在标签页可见时轮询；切回标签页时若已超过 10 秒立即补一次

/* ── 邮箱信息：汇总 / 健康 / 分组 / 域名信箱列表 ─────────────────────── */
export function useOverviewInfo() {
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')
  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? 'refreshing' : 'loading'))
    try {
      setData(await hubApi.overview())
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  return { data, state, reload: load }
}

const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || ''

/** 每个域名下的信箱数：按「根域或其子域」归到已启用的域名上，归不上的按信箱自己的域名单列 */
export function domainCounts(domains = [], boxes = []) {
  const roots = [...new Set((domains || []).map((d) => String(d).toLowerCase()))].sort((a, b) => b.length - a.length)
  const counts = new Map(roots.map((d) => [d, 0]))
  for (const b of boxes || []) {
    const dom = domainOf(b.email)
    if (!dom) continue
    const root = roots.find((r) => dom === r || dom.endsWith(`.${r}`)) || dom
    counts.set(root, (counts.get(root) || 0) + 1)
  }
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

/** 信箱地址归到哪个汇流节点 */
export function nodeIdFor(row, nodes) {
  if (row.source === 'hotmail') return 'hotmail'
  const dom = domainOf(row.mailbox)
  const hit = nodes.find((n) => n.domain && (dom === n.domain || dom.endsWith(`.${n.domain}`)))
  return hit ? hit.id : nodes.find((n) => n.id === 'd:*')?.id || nodes.find((n) => n.kind === 'domain')?.id
}

/** 汇流节点：Hotmail 池（本地版）+ 各个域名（最多 4 个节点，多出来的并成「其余 N 个域名」） */
export function buildNodes(data, t) {
  if (!data) return []
  const nodes = []
  if (!IS_CLOUD) {
    const h = data.summary?.hotmail
    nodes.push({
      id: 'hotmail',
      kind: 'hotmail',
      title: t('ov.node.hotmail'),
      value: h?.available ? h.accounts : null,
      health: h?.available && h.accounts ? { ok: h.ok, expiring: h.expiring, expired: h.expired } : null,
    })
  }
  const counts = domainCounts(data.domains, data.domainBoxes)
  const room = IS_CLOUD ? 4 : 3
  const head = counts.length > room ? counts.slice(0, room - 1) : counts
  const rest = counts.slice(head.length)
  for (const d of head) nodes.push({ id: `d:${d.domain}`, kind: 'domain', domain: d.domain, title: d.domain, value: d.count })
  if (rest.length) {
    nodes.push({
      id: 'd:*',
      kind: 'domain',
      title: t('ov.node.moreDomains', { n: rest.length }),
      value: rest.reduce((s, d) => s + d.count, 0),
    })
  }
  if (!nodes.some((n) => n.kind === 'domain')) nodes.push({ id: 'd:none', kind: 'domain', title: t('src.domain'), value: 0 })
  // 光点发射率：按节点上的数量分配（最忙的约每秒 2.6 颗，最闲的约 0.5 颗）
  const max = Math.max(1, ...nodes.map((n) => n.value || 0))
  return nodes.map((n) => ({ ...n, rate: 0.5 + 2.1 * ((n.value || 0) / max) }))
}

/** 分组选项 = 两个来源分组名的并集（同名合并、计数相加），记下各自出现在哪个来源 */
export function mergeGroups(hotmailGroups = [], domainBoxes = [], active = '') {
  const map = new Map()
  const add = (name, count, source) => {
    const key = String(name || '').trim()
    if (!key) return
    const g = map.get(key) || { name: key, count: 0, sources: new Set() }
    g.count += count
    g.sources.add(source)
    map.set(key, g)
  }
  for (const g of hotmailGroups || []) add(g?.name, Number(g?.count) || 0, 'hotmail')
  for (const b of domainBoxes || []) add(b?.group, 1, 'domain')
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true })
  const out = [...map.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
  if (active && !map.has(active)) out.unshift({ name: active, count: null, sources: new Set(['hotmail', 'domain']) })
  return out
}

/* ── 最近邮件时间线 ─────────────────────────────────────────────── */
const keyOf = (r) => `${r.source}:${r.mailbox}:${r.message_id}`
const ts = (r) => Date.parse(r?.received_at || '') || 0
const same = (a, b) =>
  a.subject === b.subject &&
  a.code === b.code &&
  a.received_at === b.received_at &&
  a.from_address === b.from_address &&
  a.from_name === b.from_name

/** 轮询结果并入现有列表：没变的行**沿用原对象**（memo 的行组件就不会重渲染），只有新行是新对象并带到达标记 */
export function mergePoll(prev, next) {
  const byKey = new Map(prev.map((r) => [r._key, r]))
  const newest = prev.reduce((m, r) => Math.max(m, ts(r)), 0)
  const arrivals = []
  const rows = next.map((raw) => {
    const r = { ...raw, _key: keyOf(raw) }
    const old = byKey.get(r._key)
    if (old) return same(old, r) ? old : { ...r, _arrival: old._arrival }
    if (prev.length === 0 || ts(r) >= newest) {
      const row = { ...r, _arrival: true }
      arrivals.push(row)
      return row
    }
    return r
  })
  if (rows.length === prev.length && rows.every((r, i) => r === prev[i])) return { rows: prev, arrivals }
  return { rows, arrivals }
}

export function useTimeline({ limit, q, source, group, onlyCodes }) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [arrival, setArrival] = useState(null) // 最近一封到达：{ id, row }
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const seq = useRef(0)
  const busy = useRef(false)
  const loaded = useRef(false) // 这组筛选是否已成功取到过一次（之前的轮询结果才算「新到」）
  const lastPoll = useRef(0)
  const params = useMemo(
    () => ({
      limit,
      q: q || undefined,
      source: !IS_CLOUD && source !== 'all' ? source : undefined,
      group: group || undefined,
      only_codes: onlyCodes ? 'true' : undefined,
    }),
    [limit, q, source, group, onlyCodes],
  )

  // 筛选变化 → 整体重取（不算「到达」）。已有数据时保留旧列表（变淡）而不是闪成骨架
  const load = useCallback(async () => {
    const id = ++seq.current
    busy.current = true
    loaded.current = false
    setState(rowsRef.current.length ? 'refreshing' : 'loading')
    try {
      const res = await hubApi.inbox(params)
      if (id !== seq.current) return
      setRows((res.rows || []).map((r) => ({ ...r, _key: keyOf(r) })))
      loaded.current = true
      setState('ready')
      lastPoll.current = Date.now()
    } catch {
      if (id === seq.current) setState('error')
    } finally {
      if (id === seq.current) busy.current = false
    }
  }, [params])

  // 轮询：同一组筛选下取最新一页，只把新行并进来
  const poll = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return
    const id = seq.current
    busy.current = true
    try {
      const res = await hubApi.inbox(params)
      if (id !== seq.current) return
      if (!loaded.current) {
        // 首次取数失败后的补救：整体替换，不当作新到的信
        setRows((res.rows || []).map((r) => ({ ...r, _key: keyOf(r) })))
        loaded.current = true
      } else {
        const { rows: merged, arrivals } = mergePoll(rowsRef.current, res.rows || [])
        if (merged !== rowsRef.current) setRows(merged)
        if (arrivals.length) setArrival({ id: arrivals[0]._key, row: arrivals[0], count: arrivals.length })
      }
      setState('ready')
    } catch {
      /* 轮询失败不打扰：下一轮再试，列表保持原样 */
    } finally {
      lastPoll.current = Date.now()
      if (id === seq.current) busy.current = false
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(poll, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPoll.current > 10_000) poll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [poll])

  return { rows, state, arrival, reload: load, poll }
}

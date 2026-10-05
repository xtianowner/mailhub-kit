import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, FolderOpen, Mailbox, RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Badge, IconButton, Spinner } from './ui.jsx'

/* ── 来源标记 ────────────────────────────────────────────────
   统一视图里每一行都必须一眼看出「这封信从哪条链路来的」，否则合并视图就是一锅粥。
   Hotmail = info（中性灰）/ 域名邮箱 = accent（青绿），两个 tone 都取自 token。 */
export function SourceBadge({ source, className }) {
  const { t } = useLocale()
  const isHot = source === 'hotmail'
  return (
    <Badge tone={isHot ? 'info' : 'accent'} className={cn('shrink-0', className)}>
      {isHot ? <Mailbox size={11} aria-hidden /> : <Cloud size={11} aria-hidden />}
      {t(isHot ? 'src.hotmail' : 'src.domain')}
    </Badge>
  )
}

/* ── 来源筛选 chips ───────────────────────────────────────── */
const SOURCES = ['all', 'hotmail', 'domain']

export function SourceFilter({ value, onPick, className }) {
  const { t } = useLocale()
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group">
      {SOURCES.map((s) => {
        const active = value === s
        return (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            aria-pressed={active}
            className={cn(
              'inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast',
              active
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border bg-surface-2 text-muted hover:text-heading',
            )}
          >
            {t(`src.${s}`)}
          </button>
        )
      })}
    </div>
  )
}

/* ── 分组筛选 chips ──────────────────────────────────────────
   Hotmail 账号页、域名邮箱页、统一总览共用同一套样式与交互：
   「全部分组」复位；每个分组胶囊带计数；再点一次当前分组也复位。选中值由父组件落 URL（?group=）。
   groups: [{ name, count }]，count 为 null 时不显示计数。 */
export function GroupFilter({ groups, active, onPick, className }) {
  const { t } = useLocale()
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="inline-flex shrink-0 items-center gap-1.5 pr-1 text-xs font-medium text-subtle">
        <FolderOpen size={13} aria-hidden />
        {t('group.filter')}
      </span>
      <button
        type="button"
        onClick={() => onPick('')}
        aria-pressed={!active}
        className={`inline-flex cursor-pointer select-none items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast ${
          !active
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-border bg-surface-2 text-muted hover:text-text'
        }`}
      >
        {t('group.all')}
      </button>
      {groups.map((g) => {
        const isActive = g.name === active
        return (
          <button
            key={g.name}
            type="button"
            onClick={() => onPick(g.name)}
            aria-pressed={isActive}
            title={g.name}
            className={`inline-flex max-w-[16rem] cursor-pointer select-none items-center gap-1.5 truncate rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast ${
              isActive
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border bg-surface-2 text-muted hover:text-text'
            }`}
          >
            <span className="truncate">{g.name}</span>
            {g.count !== null && g.count !== undefined && (
              <>
                {/* 计数不再用 70% 透明度区分（浅色只有 2.9:1、深色 3.2:1，不过 AA）：同色，细一档字重 */}
                <span className="shrink-0 font-normal tabular-nums">{g.count}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

const groupCollator = new Intl.Collator('zh-Hans-CN', { numeric: true })

// 把若干份 [{ name, count }] 按分组名（去首尾空白）合并计数：后端按去空白后的名字精确匹配，
// 两个来源同名的分组在筛选时本来就是同一个。排序：计数多的在前，同数按名字。
// active 不在结果里时补一个不带计数的胶囊（例如 URL 带着分组但列表里暂时没有），
// 否则当前生效的筛选在界面上看不见。
export function mergeGroupCounts(lists, active = '') {
  const counts = new Map()
  for (const list of lists) {
    for (const g of list || []) {
      const name = (g?.name || '').trim()
      if (!name) continue
      counts.set(name, (counts.get(name) || 0) + (Number(g.count) || 0))
    }
  }
  const out = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || groupCollator.compare(a.name, b.name))
  if (active && !counts.has(active)) out.unshift({ name: active, count: null })
  return out
}

/* ── 上游健康条 ──────────────────────────────────────────────
   两个上游任一挂了，界面要**明说哪个挂了、怎么修**，而不是让用户对着空列表猜。
   这是「本机三进程」架构必须付的解释成本。 */
export function useUpstreams() {
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      setData(await hubApi.health())
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const upstreams = data?.upstreams || []
  const allOk = state === 'ready' && upstreams.every((u) => u.ok)
  // undefined = 还没探测出来；false = Worker 未提供完整邮箱列表能力
  const workerDiscovery = data?.worker_discovery
  return { data, upstreams, state, allOk, workerDiscovery, reload: load }
}

export function UpstreamBar({ upstreams, state, onRetry, workerDiscovery, className }) {
  const { t } = useLocale()

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="inline-flex shrink-0 items-center gap-1.5 pr-1 text-xs font-medium text-subtle">
        {t('up.title')}
      </span>
      {state === 'loading' && <Spinner size={14} className="text-muted" />}
      {/* 本地版会探测线上 Worker 的邮箱列表能力；云端版直连同一套 CFMail。 */}
      {!IS_CLOUD && state === 'ready' && workerDiscovery === false && (
        <span
          title={t('up.worker.legacy.hint')}
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs font-medium text-warning"
        >
          <AlertTriangle size={12} aria-hidden />
          {t('up.worker.legacy')}
        </span>
      )}
      {upstreams.map((u) => {
        const hint = t(u.source === 'hotmail' ? 'up.hotmail.hint' : 'up.domain.hint')
        const label = u.ok
          ? t('up.ok')
          : u.detail?.includes('未配置') || u.detail?.includes('密钥')
            ? t('up.unconfigured')
            : t('up.down')
        return (
          <span
            key={u.source}
            title={u.detail ? `${hint}\n${u.detail}` : hint}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              u.ok
                ? 'border-success/25 bg-success/10 text-success'
                : 'border-warning/40 bg-warning/5 text-warning',
            )}
          >
            {u.ok ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
            {t(u.source === 'hotmail' ? 'src.hotmail' : 'src.domain')}
            <span>· {label}</span>
          </span>
        )
      })}
      <IconButton title={t('up.retry')} onClick={onRetry} className="h-7 w-7">
        <RefreshCw size={13} />
      </IconButton>
    </div>
  )
}

/* ── 页头 ───────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold text-heading sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

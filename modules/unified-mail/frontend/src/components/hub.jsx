import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, Mailbox, RefreshCw } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Badge, IconButton, Spinner } from './ui.jsx'

/* ── 来源标记 ────────────────────────────────────────────────
   统一视图里每一行都必须一眼看出「这封信从哪条链路来的」，否则合并视图就是一锅粥。
   Hotmail = info(蓝) / 域名邮箱 = accent(紫)，两个 tone 都取自 token。 */
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
                : 'border-border/70 bg-surface-2/50 text-muted hover:text-text',
            )}
          >
            {t(`src.${s}`)}
          </button>
        )
      })}
    </div>
  )
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
  // undefined = 还没探测出来；false = 线上 Worker 是旧版（收件箱会漏信）
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
      {/* 「Worker 旧版」只是本地版才有的概念（本地要探线上 Worker 是哪一版）。
          云端版本身就跑在线上、直连 CFMail，挂这个标签只会让人困惑。 */}
      {!IS_CLOUD && state === 'ready' && workerDiscovery === false && (
        <span
          title={t('up.worker.legacy.hint')}
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning"
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
                : 'border-warning/25 bg-warning/10 text-warning',
            )}
          >
            {u.ok ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
            {t(u.source === 'hotmail' ? 'src.hotmail' : 'src.domain')}
            <span className="opacity-70">· {label}</span>
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
        <h1 className="font-heading text-xl font-semibold text-text sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

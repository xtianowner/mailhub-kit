import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  RefreshCw,
  RotateCw,
  Trash2,
  LogIn,
  KeyRound,
  Upload,
  ChevronDown,
  Clock,
  ArrowDownAZ,
  Tags,
  FolderOpen,
  StickyNote,
  AtSign,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDate, fmtRelative, bucketTone } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button, Badge, Card, CopyCode } from '../components/ui.jsx'
import { Pager, PAGE_SIZE_OPTIONS } from '../components/Pager.jsx'
import { StateBlock } from '../components/StateBlock.jsx'
import { PageHeader } from '../components/hub.jsx'

const BUCKETS = ['total', 'ok', 'expiring', 'expired', 'never', 'dead']
const SORTS = ['recent', 'id']

// Literal class maps — Tailwind JIT only scans literal strings, never `text-${x}`.
const TEXT_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  accent: 'text-accent',
  subtle: 'text-subtle',
}
const DOT_TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  subtle: 'bg-subtle',
}

export default function OverviewPage() {
  const { t, locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const bucket = params.get('bucket') || ''
  const q = params.get('q') || ''
  const group = params.get('group') || ''
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
  const rawSize = parseInt(params.get('size') || '50', 10)
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawSize) ? rawSize : 50
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'recent'
  const [searchInput, setSearchInput] = useState(q)

  const [summary, setSummary] = useState(null)
  const [groups, setGroups] = useState([]) // [{name,count}]
  const [data, setData] = useState(null) // {rows,total,page,pages}
  const [listState, setListState] = useState('loading') // loading|error|ready
  const [rowBusy, setRowBusy] = useState({}) // id -> 'refresh'|'code'|'delete'
  const [rowCode, setRowCode] = useState({}) // id -> {code|null}

  // ── data loading ─────────────────────────────────────────
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.summary())
    } catch {
      /* summary failure is non-fatal */
    }
  }, [])

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.groups()
      setGroups(res.groups || [])
    } catch {
      /* group list failure is non-fatal */
    }
  }, [])

  const loadList = useCallback(async () => {
    setListState('loading')
    try {
      const res = await api.accounts({
        q: q || undefined,
        bucket: bucket || undefined,
        group: group || undefined,
        page,
        page_size: pageSize,
        sort,
      })
      setData(res)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [q, bucket, group, page, pageSize, sort])

  useEffect(() => {
    loadSummary()
    loadGroups()
  }, [loadSummary, loadGroups])
  useEffect(() => {
    loadList()
  }, [loadList])

  // keep input in sync when q changes via card/url
  useEffect(() => {
    setSearchInput(q)
  }, [q])

  const setParam = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const onSearch = (e) => {
    e?.preventDefault?.()
    setParam({ q: searchInput.trim() || undefined, page: undefined })
  }

  const onBucket = (b) => {
    const target = b === 'total' ? '' : b
    setParam({ bucket: target === bucket ? '' : target || undefined, page: undefined })
  }

  const onGroup = (g) => {
    // empty string = "all groups" reset; clicking the active group also resets.
    setParam({ group: g && g !== group ? g : undefined, page: undefined })
  }

  // page / size / sort changes all reset scroll to the top of the list
  const onPage = (p) => {
    setParam({ page: p > 1 ? p : undefined })
    scrollTop()
  }
  const onPageSize = (n) => {
    setParam({ size: n === 50 ? undefined : n, page: undefined })
    scrollTop()
  }
  const onSort = (s) => {
    setParam({ sort: s === 'recent' ? undefined : s, page: undefined })
    scrollTop()
  }

  // ── per-row actions ──────────────────────────────────────
  const refreshAll = async () => {
    await Promise.all([loadList(), loadSummary(), loadGroups()])
  }

  const onRowRefresh = async (acc) => {
    setRowBusy((m) => ({ ...m, [acc.id]: 'refresh' }))
    try {
      const res = await api.refreshAccount(acc.id)
      setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === acc.id ? res.account : r)) }))
      loadSummary()
      if (res.result?.ok) toast.success(t('action.refresh') + ' ✓')
      else toast.error(res.result?.error || t('common.error'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [acc.id]: undefined }))
    }
  }

  const onRowCode = async (acc) => {
    setRowBusy((m) => ({ ...m, [acc.id]: 'code' }))
    try {
      const res = await api.getCode(acc.id)
      setRowCode((m) => ({ ...m, [acc.id]: res }))
      if (res.dead) toast.error(t('status.dead'))
      else if (!res.found) toast.info(t('account.code.none'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [acc.id]: undefined }))
    }
  }

  const onRowDelete = async (acc) => {
    if (!window.confirm(t('action.confirmDelete') + `\n${acc.email}`)) return
    setRowBusy((m) => ({ ...m, [acc.id]: 'delete' }))
    try {
      await api.deleteAccount(acc.id)
      await refreshAll()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [acc.id]: undefined }))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 统一外壳的主导航只到「Hotmail 账号」这一层，别名是它的子页面，
          入口放在这里而不是挤进顶栏（顶栏 5 项已是窄屏上限）。 */}
      <PageHeader
        title={t('nav.hotmail')}
        subtitle={t('overview.subtitle')}
        actions={
          <Button variant="ghost" size="md" onClick={() => navigate('/hotmail/aliases')}>
            <AtSign size={15} />
            {t('nav.aliases')}
          </Button>
        }
      />

      <SummaryCards summary={summary} active={bucket} onPick={onBucket} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <SearchBulk
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          onSearch={onSearch}
          onBulkDone={refreshAll}
        />
        <ImportBox onImported={refreshAll} />
      </div>

      {groups.length > 0 && (
        <GroupFilter groups={groups} active={group} onPick={onGroup} t={t} />
      )}

      <AccountsTable
        listState={listState}
        data={data}
        rowBusy={rowBusy}
        rowCode={rowCode}
        locale={locale}
        t={t}
        pageSize={pageSize}
        sort={sort}
        onEnter={(acc) => navigate(`/hotmail/accounts/${acc.id}`)}
        onRefresh={onRowRefresh}
        onCode={onRowCode}
        onDelete={onRowDelete}
        onRetry={loadList}
        onPage={onPage}
        onPageSize={onPageSize}
        onSort={onSort}
      />
    </div>
  )
}

/* ── Summary cards ─────────────────────────────────────────── */
function SummaryCards({ summary, active, onPick }) {
  const { t } = useLocale()
  const valueOf = (b) => {
    if (!summary) return '—'
    return b === 'total' ? summary.total : summary[b]
  }
  const tone = (b) =>
    b === 'total' ? 'accent' : b === 'never' ? 'subtle' : bucketTone(b)
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {BUCKETS.map((b) => {
        const isActive = (b === 'total' && !active) || b === active
        const tn = tone(b)
        return (
          <button
            key={b}
            onClick={() => onPick(b)}
            className={`group flex cursor-pointer flex-col items-start gap-1 rounded-lg border bg-surface/60 px-3.5 py-3 text-left backdrop-blur-sm transition-all duration-fast hover:border-accent/50 ${
              isActive ? 'border-accent/70 ring-1 ring-accent/30' : 'border-border/70'
            }`}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[tn]}`} />
              {t(`bucket.${b}`)}
            </span>
            <span className="font-heading text-2xl font-semibold tabular-nums text-text">
              {valueOf(b)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Group filter (chips) ──────────────────────────────────────
   Renders once at least one user-defined group exists. "All groups" resets
   the filter; each chip carries its account count. Selection is URL-persisted
   by the parent (?group=). Clicking the active chip also resets. */
function GroupFilter({ groups, active, onPick, t }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
            : 'border-border/70 bg-surface-2/50 text-muted hover:text-text'
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
                : 'border-border/70 bg-surface-2/50 text-muted hover:text-text'
            }`}
          >
            <span className="truncate">{g.name}</span>
            <span className="shrink-0 tabular-nums opacity-70">{g.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Search + bulk-refresh bar (with polling progress) ─────── */
function SearchBulk({ searchInput, setSearchInput, onSearch, onBulkDone }) {
  const { t } = useLocale()
  const toast = useToast()
  const [status, setStatus] = useState(null) // bulk-status object
  const pollRef = useRef(null)
  const startingRef = useRef(false)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // resume polling if a bulk job is already running on mount
  useEffect(() => {
    let cancelled = false
    api
      .bulkStatus()
      .then((s) => {
        if (!cancelled && s.running) {
          setStatus(s)
          startPoll()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      stopPoll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startPoll = () => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.bulkStatus()
        setStatus(s)
        if (!s.running) {
          stopPoll()
          onBulkDone?.()
          toast.success(t('overview.bulk.done'))
        }
      } catch {
        stopPoll()
      }
    }, 2000)
  }

  const onBulk = async (kind) => {
    if (startingRef.current || status?.running) return
    startingRef.current = true
    try {
      const res = await api.bulkRefresh(kind)
      if (res.started) {
        setStatus({ running: true, kind, total: res.total, done: 0, ok: 0, dead: 0, error: 0 })
        startPoll()
      } else {
        toast.info(res.reason || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      startingRef.current = false
    }
  }

  const running = !!status?.running
  const pct = status && status.total ? Math.round((status.done / status.total) * 100) : 0

  return (
    <Card className="flex flex-col gap-3 p-4">
      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('overview.search.placeholder')}
            className="h-10 w-full rounded border border-border bg-surface-2/60 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <Button type="submit" variant="solid">
          {t('overview.search')}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" onClick={() => onBulk('all')} disabled={running}>
          <RefreshCw size={14} />
          {t('overview.bulk.all')}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => onBulk('expiring')} disabled={running}>
          {t('overview.bulk.expiring')}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => onBulk('dead')} disabled={running}>
          {t('overview.bulk.dead')}
        </Button>
      </div>

      {running && status && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={12} className="animate-spin text-accent" />
              {t('overview.bulk.running')} · {t(`bucket.${status.kind === 'all' ? 'total' : status.kind}`)}
            </span>
            <span className="tabular-nums">
              {status.done}/{status.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient transition-all duration-base"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex gap-3 text-[11px] text-subtle">
            <span className="text-success">ok {status.ok}</span>
            <span className="text-danger">dead {status.dead}</span>
            <span>err {status.error}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

/* ── Import box ────────────────────────────────────────────── */
function ImportBox({ onImported }) {
  const { t } = useLocale()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [showErrors, setShowErrors] = useState(false)

  const onImport = async () => {
    if (!text.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const res = await api.importAccounts(text)
      setResult(res)
      if (res.errors?.length) setShowErrors(true)
      const acc = res.accounts_added ?? res.added ?? 0
      const ali = res.aliases_added ?? 0
      toast.success(`+${acc} ${t('overview.import.accountsAdded')}${ali ? ` · +${ali} ${t('overview.import.aliasesAdded')}` : ''}`)
      setText('')
      onImported?.()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <span className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Upload size={14} className="text-muted" />
        {t('overview.import.title')}
      </span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('overview.import.placeholder')}
        rows={3}
        className="w-full resize-y rounded border border-border bg-surface-2/60 px-3 py-2 font-mono text-xs text-text placeholder:text-subtle focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        {result ? (
          <span className="text-xs text-muted">
            <span className="text-success">+{result.accounts_added ?? result.added ?? 0}</span>{' '}
            {t('overview.import.accountsAdded')} ·{' '}
            <span className="text-info">{result.accounts_existing ?? result.updated ?? 0}</span>{' '}
            {t('overview.import.accountsExisting')} ·{' '}
            <span className="text-accent">+{result.aliases_added ?? 0}</span>{' '}
            {t('overview.import.aliasesAdded')} · <span>{result.skipped ?? 0}</span>{' '}
            {t('overview.import.skipped')}
          </span>
        ) : (
          <span />
        )}
        <Button size="sm" variant="solid" loading={busy} onClick={onImport} disabled={!text.trim()}>
          {t('overview.import.btn')}
        </Button>
      </div>
      {result?.errors?.length > 0 && (
        <div className="text-xs">
          <button
            onClick={() => setShowErrors((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 text-danger hover:underline"
          >
            <ChevronDown
              size={13}
              className={`transition-transform ${showErrors ? 'rotate-0' : '-rotate-90'}`}
            />
            {result.errors.length} {t('overview.import.errors')}
          </button>
          {showErrors && (
            <ul className="mt-1 max-h-32 list-disc overflow-auto rounded bg-surface-2/60 px-5 py-2 text-subtle">
              {result.errors.map((e, i) => (
                <li key={i} className="break-all">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

/* ── Sort toggle (recent / id) — sits in the table toolbar ── */
function SortToggle({ sort, onSort, t }) {
  const opts = [
    { key: 'recent', label: t('sort.recent'), icon: Clock },
    { key: 'id', label: t('sort.id'), icon: ArrowDownAZ },
  ]
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-surface-2/40 p-0.5"
      role="group"
      aria-label={t('sort.label')}
    >
      {opts.map(({ key, label, icon: Icon }) => {
        const active = sort === key
        return (
          <button
            key={key}
            onClick={() => onSort(key)}
            aria-pressed={active}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
              active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            <Icon size={13} aria-hidden />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Accounts table ────────────────────────────────────────── */
function AccountsTable({
  listState,
  data,
  rowBusy,
  rowCode,
  locale,
  t,
  pageSize,
  sort,
  onEnter,
  onRefresh,
  onCode,
  onDelete,
  onRetry,
  onPage,
  onPageSize,
  onSort,
}) {
  const rows = data?.rows || []
  return (
    <Card className="overflow-hidden p-0">
      {/* reachable toolbar above the table — pager + sort, no scroll needed */}
      <div className="border-b border-border/70 px-4 py-3">
        <Pager
          data={data || { page: 1, pages: 1, total: 0 }}
          pageSize={pageSize}
          onPage={onPage}
          onPageSize={onPageSize}
          slot={<SortToggle sort={sort} onSort={onSort} t={t} />}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-xs font-medium uppercase tracking-wide text-subtle">
              <th className="px-4 py-2.5 align-middle font-medium">{t('table.email')}</th>
              <th className="w-[90px] px-3 py-2.5 align-middle font-medium">{t('table.status')}</th>
              <th className="w-[150px] px-3 py-2.5 align-middle font-medium">{t('table.rt')}</th>
              <th className="w-[120px] px-3 py-2.5 align-middle font-medium">{t('table.lastRefresh')}</th>
              <th className="w-[130px] px-3 py-2.5 align-middle font-medium">{t('table.lastCode')}</th>
              <th className="w-[230px] px-4 py-2.5 text-right align-middle font-medium">
                {t('table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {listState === 'ready' && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="align-middle">
                  <StateBlock state="empty" />
                </td>
              </tr>
            )}
            {listState === 'loading' && (
              <tr>
                <td colSpan={6} className="align-middle">
                  <StateBlock state="loading" />
                </td>
              </tr>
            )}
            {listState === 'error' && (
              <tr>
                <td colSpan={6} className="align-middle">
                  <StateBlock state="error" onRetry={onRetry} />
                </td>
              </tr>
            )}
            {listState === 'ready' &&
              rows.map((acc) => (
                <AccountRow
                  key={acc.id}
                  acc={acc}
                  busy={rowBusy[acc.id]}
                  code={rowCode[acc.id]}
                  locale={locale}
                  t={t}
                  onEnter={onEnter}
                  onRefresh={onRefresh}
                  onCode={onCode}
                  onDelete={onDelete}
                />
              ))}
          </tbody>
        </table>
      </div>

      {/* compact bottom pager (optional convenience) */}
      {listState === 'ready' && data && data.pages > 1 && (
        <div className="border-t border-border/70 px-4 py-3">
          <Pager
            data={data}
            pageSize={pageSize}
            onPage={onPage}
            onPageSize={onPageSize}
          />
        </div>
      )}
    </Card>
  )
}

function AccountRow({ acc, busy, code, locale, t, onEnter, onRefresh, onCode, onDelete }) {
  const tone = bucketTone(acc.bucket)
  const statusTone = acc.status === 'dead' ? 'danger' : 'success'
  const rtText =
    acc.rt_days_left === null || acc.rt_days_left === undefined
      ? t('table.never')
      : acc.rt_days_left < 0
        ? t('table.expired')
        : `${acc.rt_days_left} ${t('table.days')}`
  // code result shown after pressing 接码 (always fresh); else fall back to the
  // stored last_code, which is stale/grey when code_fresh===false.
  const fetched = code && code.found ? code.code : null
  const showCode = fetched || acc.last_code
  const stale = !fetched && acc.code_fresh === false && !!acc.last_code
  const staleAgo = acc.last_code_at ? fmtRelative(acc.last_code_at, locale) : ''

  return (
    <tr className="border-b border-border/50 transition-colors duration-fast hover:bg-surface-2/40">
      <td className="max-w-[340px] px-4 py-2.5 align-middle">
        {/* td stays table-cell; flex/grid live on inner divs (table-align rule) */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEnter(acc)}
              className="min-w-0 cursor-pointer truncate font-medium text-text hover:text-accent"
              title={acc.email}
            >
              {acc.email}
            </button>
            {acc.alias_count > 1 && (
              <Badge tone="accent" className="shrink-0 px-1.5 py-0">
                <Tags size={11} aria-hidden />
                {t('table.aliasBadge', { n: acc.alias_count })}
              </Badge>
            )}
          </div>
          {(acc.group_name || acc.note) && (
            <div className="flex min-w-0 items-center gap-2">
              {acc.group_name && (
                <Badge tone="subtle" className="shrink-0 px-1.5 py-0" title={acc.group_name}>
                  <FolderOpen size={10} aria-hidden />
                  <span className="max-w-[8rem] truncate">{acc.group_name}</span>
                </Badge>
              )}
              {acc.note && (
                <span
                  className="inline-flex min-w-0 items-center gap-1 text-xs text-muted"
                  title={acc.note}
                >
                  <StickyNote size={11} className="shrink-0 text-subtle" aria-hidden />
                  <span className="truncate">{acc.note}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <Badge tone={statusTone} dot>
          {t(`status.${acc.status}`)}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        <div className="flex flex-col leading-tight">
          <span className={`text-sm font-medium ${TEXT_TONE[tone]}`}>{rtText}</span>
          {acc.rt_expires_at && (
            <span className="text-[11px] tabular-nums text-subtle">{fmtDate(acc.rt_expires_at)}</span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs text-muted">
        {acc.last_refresh_at ? fmtRelative(acc.last_refresh_at, locale) : t('common.none')}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        {showCode ? (
          <CopyCode
            code={showCode}
            size="sm"
            stale={stale}
            staleLabel={t('code.history')}
            staleTitle={stale ? t('code.history.hint', { ago: staleAgo }) : undefined}
          />
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => onEnter(acc)} title={t('action.enter')}>
            <LogIn size={13} />
            <span className="hidden xl:inline">{t('action.enter')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'code'}
            onClick={() => onCode(acc)}
            title={t('action.code')}
          >
            {busy !== 'code' && <KeyRound size={13} />}
            <span className="hidden xl:inline">{t('action.code')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'refresh'}
            onClick={() => onRefresh(acc)}
            title={t('action.refresh')}
          >
            {busy !== 'refresh' && <RotateCw size={13} />}
            <span className="hidden xl:inline">{t('action.refresh')}</span>
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy === 'delete'}
            onClick={() => onDelete(acc)}
            title={t('action.delete')}
          >
            {busy !== 'delete' && <Trash2 size={13} />}
          </Button>
        </div>
      </td>
    </tr>
  )
}


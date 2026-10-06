import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, AtSign, Clock, KeyRound, RefreshCw, RotateCcw, RotateCw, StickyNote, Tags, Trash2, Upload } from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDateTime, fmtRelative } from '../lib/format.js'
import { useNow } from '../lib/motion.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { PageHeader, mergeGroupCounts } from '../components/hub.jsx'
import { DetailDrawer } from '../components/DetailDrawer.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { VirtualList } from '../components/VirtualList.jsx'
import { SearchCommand } from '../components/overview/SearchCommand.jsx'
import { AccountStatus, ActBtn, CodeCell, CopyAddr, GroupSelect, SegFilter, rowSpotlight } from '../components/work.jsx'
import { AccountDrawer } from '../components/hotmail/AccountDrawer.jsx'
import { ImportDialog } from '../components/hotmail/ImportDialog.jsx'
import { useConfirm } from '../components/ConfirmDialog.jsx'
import { useBulkRefresh } from '../components/hotmail/useBulkRefresh.js'

// 一次取回全部账号（沿用 /accounts 接口，只是把每页条数放大到一次装下），筛选「状态」在前端做：
// 切状态不再发请求，计数也直接从这一份数据里算。搜索、分组、排序仍交给后端（搜索要连别名一起查）。
const ALL = 5000
const BUCKETS = ['ok', 'expiring', 'expired', 'dead', 'never']
const SORTS = ['recent', 'id']
const DRAWER_KEY = 'acct'

function patchParams(params, patch) {
  const next = new URLSearchParams(params)
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k)
    else next.set(k, v)
  }
  // 改版前的分页参数已无意义（虚拟滚动一次装下全部），顺手清掉
  next.delete('page')
  next.delete('size')
  return next
}

/* Hotmail 账号（干活层）：顶部搜索 + 状态分段胶囊（带计数）+ 分组 + 排序 + 批量刷新 / 导入，
   下面是 1500+ 行的虚拟滚动账号表（只渲染可视区），点一行在右侧抽屉看账号详情和邮件。
   筛选与打开的账号都落在 URL（q / group / bucket / sort / acct）：刷新、分享后视图不丢，浏览器后退 = 关抽屉。 */
export default function OverviewPage() {
  const { t, locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const now = useNow(30_000)

  const q = (params.get('q') || '').trim()
  const group = (params.get('group') || '').trim()
  const bucket = BUCKETS.includes(params.get('bucket')) ? params.get('bucket') : ''
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'recent'
  const acct = params.get(DRAWER_KEY) || ''

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState('loading') // loading | refreshing | ready | error
  const [groups, setGroups] = useState([])
  const [rowBusy, setRowBusy] = useState({}) // id -> 'refresh' | 'code' | 'delete'
  const [rowCode, setRowCode] = useState({}) // id -> 接码结果
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const setParam = useCallback((patch) => setParams((prev) => patchParams(prev, patch), { replace: true }), [setParams])

  /* ── 数据 ── */
  const reqId = useRef(0)
  const loadList = useCallback(async () => {
    const id = ++reqId.current
    setState((s) => (s === 'loading' || s === 'error' ? 'loading' : 'refreshing'))
    try {
      const res = await api.accounts({ q: q || undefined, group: group || undefined, sort, page: 1, page_size: ALL })
      if (id !== reqId.current) return
      setRows(res.rows || [])
      setTotal(res.total ?? (res.rows || []).length)
      setState('ready')
    } catch {
      if (id === reqId.current) setState('error')
    }
  }, [q, group, sort])

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.groups()
      setGroups(res.groups || [])
    } catch {
      /* 分组取不到不影响列表 */
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])
  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadList(), loadGroups()])
  }, [loadList, loadGroups])

  const bulk = useBulkRefresh(refreshAll)

  /* ── 派生：状态计数 + 当前可见行 ── */
  const counts = useMemo(() => {
    const c = { ok: 0, expiring: 0, expired: 0, dead: 0, never: 0 }
    for (const r of rows) c[r.bucket] = (c[r.bucket] || 0) + 1
    return c
  }, [rows])
  const visible = useMemo(() => (bucket ? rows.filter((r) => r.bucket === bucket) : rows), [rows, bucket])
  const groupOpts = useMemo(() => mergeGroupCounts([groups], group), [groups, group])
  const filtersActive = Boolean(q || group || bucket)

  const segOptions = [
    { value: '', label: t('bucket.total'), count: rows.length },
    { value: 'ok', label: t('bucket.ok'), count: counts.ok, tone: 'ok' },
    { value: 'expiring', label: t('bucket.expiring'), count: counts.expiring, tone: 'warn' },
    { value: 'expired', label: t('bucket.expired'), count: counts.expired, tone: 'bad' },
    // 失效 / 未刷新：有这类账号（或正在筛选它）时才出现
    ...(counts.dead || bucket === 'dead' ? [{ value: 'dead', label: t('bucket.dead'), count: counts.dead, tone: 'bad' }] : []),
    ...(counts.never || bucket === 'never' ? [{ value: 'never', label: t('bucket.never'), count: counts.never, tone: 'muted' }] : []),
  ]

  /* ── 行操作（引用恒定，行组件 memo 才不会整表重渲染）── */
  const busyOn = (id, v) => setRowBusy((m) => ({ ...m, [id]: v }))
  const handlers = useRef({})
  handlers.current = {
    code: async (acc) => {
      busyOn(acc.id, 'code')
      try {
        const res = await api.getCode(acc.id)
        setRowCode((m) => ({ ...m, [acc.id]: res }))
        if (res.dead) toast.error(t('status.dead'))
        else if (!res.found) toast.info(t('account.code.none'))
      } catch {
        toast.error(t('common.error'))
      } finally {
        busyOn(acc.id, undefined)
      }
    },
    refresh: async (acc) => {
      busyOn(acc.id, 'refresh')
      try {
        const res = await api.refreshAccount(acc.id)
        if (res.account) setRows((list) => list.map((r) => (r.id === acc.id ? res.account : r)))
        if (res.result?.ok) toast.success(`${t('action.refresh')} ✓`)
        else toast.error(res.result?.error || t('common.error'))
      } catch {
        toast.error(t('common.error'))
      } finally {
        busyOn(acc.id, undefined)
      }
    },
    remove: async (acc) => {
      const ok = await confirm({
        title: t('action.confirmDelete'),
        object: acc.email,
        description: t('action.confirmDelete.desc'),
        confirmLabel: t('action.delete'),
      })
      if (!ok) return
      busyOn(acc.id, 'delete')
      try {
        await api.deleteAccount(acc.id)
        await refreshAll()
      } catch {
        toast.error(t('common.error'))
      } finally {
        busyOn(acc.id, undefined)
      }
    },
  }
  const onCode = useCallback((acc) => handlers.current.code(acc), [])
  const onRefresh = useCallback((acc) => handlers.current.refresh(acc), [])
  const onDelete = useCallback((acc) => handlers.current.remove(acc), [])

  /* ── 抽屉（URL 即状态：打开推一条历史，后退即关闭）── */
  const pushed = useRef(false)
  useEffect(() => {
    if (!acct) pushed.current = false
  }, [acct])
  const setParamsRef = useRef(setParams)
  setParamsRef.current = setParams
  const onOpen = useCallback((acc) => {
    pushed.current = true
    setParamsRef.current((prev) => patchParams(prev, { [DRAWER_KEY]: String(acc.id) }), { replace: false })
  }, [])
  const closeDrawer = useCallback(() => {
    if (pushed.current) {
      pushed.current = false
      navigate(-1)
    } else {
      setParam({ [DRAWER_KEY]: '' })
    }
  }, [navigate, setParam])
  const preview = useMemo(() => (acct ? rows.find((r) => String(r.id) === acct) : null), [acct, rows])

  /* ── 表格 ── */
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1100
  const renderItem = useCallback(
    (acc) => (
      <AccountRow
        acc={acc}
        busy={rowBusy[acc.id]}
        codeRes={rowCode[acc.id]}
        q={q}
        now={now}
        locale={locale}
        t={t}
        onOpen={onOpen}
        onCode={onCode}
        onRefresh={onRefresh}
        onDelete={onDelete}
      />
    ),
    [rowBusy, rowCode, q, now, locale, t, onOpen, onCode, onRefresh, onDelete],
  )
  const spot = useMemo(() => rowSpotlight('.mh-arow'), [])

  let body
  if (state === 'loading') {
    body = <EnvelopeSkeleton rows={8} label={t('common.loading')} />
  } else if (state === 'error' && rows.length === 0) {
    body = (
      <EmptyState
        pose="search"
        tone="danger"
        icon={AlertTriangle}
        title={t('hm.list.errorTitle')}
        desc={t('hm.list.errorDesc')}
        action={
          <button type="button" className="mh-btn mh-btn--ghost" onClick={loadList}>
            <RotateCcw size={14} aria-hidden />
            {t('common.retry')}
          </button>
        }
      />
    )
  } else if (visible.length === 0) {
    body = filtersActive ? (
      <EmptyState
        pose="search"
        title={t('table.empty')}
        desc={t('hm.list.emptyFilteredDesc')}
        action={
          <button type="button" className="mh-btn mh-btn--ghost" onClick={() => setParam({ q: '', group: '', bucket: '' })}>
            <RotateCcw size={14} aria-hidden />
            {t('ov.filter.resetAll')}
          </button>
        }
      />
    ) : (
      <EmptyState
        pose="wait"
        title={t('hm.list.emptyTitle')}
        desc={t('hm.list.emptyDesc')}
        action={
          <button type="button" className="mh-btn mh-btn--primary" onClick={() => setImportOpen(true)}>
            <Upload size={15} aria-hidden />
            {t('overview.import.title')}
          </button>
        }
      />
    )
  } else {
    body = (
      <VirtualList
        items={visible}
        getKey={(a) => a.id}
        estimateSize={wide ? 62 : 132}
        renderItem={renderItem}
        className={state === 'refreshing' ? 'is-busy' : ''}
        label={t('hm.list.title')}
        onMouseMove={spot}
      />
    )
  }

  const bs = bulk.status
  return (
    <div className="mh-page">
      <PageHeader
        title={t('nav.hotmail')}
        subtitle={t('overview.subtitle')}
        actions={
          <>
            <Link to="/hotmail/aliases" className="mh-btn mh-btn--quiet">
              <AtSign size={15} aria-hidden />
              {t('nav.aliases')}
            </Link>
            <button type="button" className="mh-btn mh-btn--primary" onClick={() => setImportOpen(true)}>
              <Upload size={15} aria-hidden />
              {t('overview.import.title')}
            </button>
          </>
        }
      />

      <section className="mh-card mh-tool" aria-label={t('hm.tools')}>
        <SearchCommand
          compact
          value={q}
          onSearch={(v) => setParam({ q: v })}
          placeholder={t('overview.search.placeholder')}
          label={t('overview.search')}
          resultHint={state === 'ready' ? t('hm.search.hint', { n: visible.length }) : undefined}
        />
        <div className="mh-tool__row">
          <SegFilter
            options={segOptions}
            value={bucket}
            onChange={(b) => setParam({ bucket: b })}
            label={t('hm.filter.status')}
            layoutId="mh-hm-bucket"
          />
          <GroupSelect groups={groupOpts} value={group} onChange={(g) => setParam({ group: g })} />
          {filtersActive && (
            <button type="button" className="mh-linkbtn" onClick={() => setParam({ q: '', group: '', bucket: '' })}>
              <RotateCcw size={13} aria-hidden />
              {t('ov.filter.reset')}
            </button>
          )}
        </div>
        <div className="mh-tool__row mh-tool__bulk">
          <span className="mh-tool__label">
            <RefreshCw size={14} aria-hidden />
            {t('hm.bulk.label')}
          </span>
          {['all', 'expiring', 'dead'].map((kind) => (
            <button key={kind} type="button" className="mh-btn mh-btn--quiet mh-btn--sm" onClick={() => bulk.start(kind)} disabled={bulk.running}>
              {t(`overview.bulk.${kind}`)}
            </button>
          ))}
          {bulk.running && bs && (
            <div className="mh-bulk" role="status" aria-live="polite">
              <span className="mh-bulk__head">
                <RefreshCw size={13} className="mh-spin" aria-hidden />
                {t('overview.bulk.running')} · {t(`bucket.${bs.kind === 'all' ? 'total' : bs.kind}`)}
                <span className="mh-bulk__num">
                  {bs.done}/{bs.total}
                </span>
              </span>
              <span className="mh-bulk__bar" aria-hidden>
                <span style={{ transform: `scaleX(${bulk.pct / 100})` }} />
              </span>
              <span className="mh-bulk__stats">
                <span className="is-ok">{t('overview.bulk.stat.ok', { n: bs.ok })}</span>
                <span className="is-bad">{t('overview.bulk.stat.dead', { n: bs.dead })}</span>
                <span>{t('overview.bulk.stat.error', { n: bs.error })}</span>
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="mh-card mh-atable" aria-labelledby="mh-at-title">
        <header className="mh-atable__head">
          <div className="mh-atable__titles">
            <h2 id="mh-at-title" className="mh-h2">
              {t('hm.list.title')}
            </h2>
            {state !== 'loading' && (
              <p className="mh-atable__count">
                {filtersActive ? t('hm.list.countFiltered', { shown: visible.length, total }) : t('hm.list.count', { n: total })}
              </p>
            )}
          </div>
          <SegFilter
            size="sm"
            options={[
              { value: 'recent', label: t('sort.recent') },
              { value: 'id', label: t('sort.id') },
            ]}
            value={sort}
            onChange={(v) => setParam({ sort: v === 'recent' ? '' : v })}
            label={t('sort.label')}
            layoutId="mh-hm-sort"
          />
        </header>
        {state === 'error' && rows.length > 0 && (
          <p className="mh-timeline__warn" role="status">
            <AlertTriangle size={14} aria-hidden />
            {t('hm.list.refreshFailed')}
            <button type="button" className="mh-linkbtn" onClick={loadList}>
              {t('common.retry')}
            </button>
          </p>
        )}
        {visible.length > 0 && state !== 'loading' && (
          <div className="mh-acols" aria-hidden>
            <span>{t('table.email')}</span>
            <span>{t('table.status')}</span>
            <span>{t('meta.group')}</span>
            <span>{t('hm.col.lastMail')}</span>
            <span>{t('table.lastCode')}</span>
            <span className="mh-acols__end">{t('table.actions')}</span>
          </div>
        )}
        {body}
        {state !== 'loading' && total > rows.length && rows.length > 0 && (
          <p className="mh-atable__foot">{t('hm.list.truncated', { n: rows.length, total })}</p>
        )}
      </section>

      {/* 与邮件抽屉一样可拖拽调宽、可全屏；宽度单独记（键 mh.drawer.width.account，邮件抽屉是 …mail） */}
      <DetailDrawer
        open={Boolean(acct)}
        onClose={closeDrawer}
        title={t('hm.drawer.title')}
        titleId="mh-acct-drawer-title"
        resizeKey="account"
        allowFullscreen
      >
        {acct && (
          <AccountDrawer
            key={acct}
            accountId={acct}
            preview={preview}
            busy={rowBusy[acct]}
            codeRes={rowCode[acct]}
            onCode={onCode}
            onRefresh={onRefresh}
            now={now}
          />
        )}
      </DetailDrawer>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={refreshAll} />
      {confirmDialog}
    </div>
  )
}

/* 单行：memo 包裹，只在自己的数据（行对象引用）、忙碌状态、接码结果、搜索词、相对时间或语言变化时重渲染。
   整行可点（打开抽屉）：透明的打开按钮铺满整行；地址、验证码、操作按钮叠在它上面，各管各的。 */
const AccountRow = memo(function AccountRow({ acc, busy, codeRes, q, now, locale, t, onOpen, onCode, onRefresh, onDelete }) {
  const fetched = codeRes && codeRes.found ? codeRes.code : null
  const stale = !fetched && acc.code_fresh === false && !!acc.last_code
  const dead = acc.status === 'dead'
  const refreshed = acc.last_refresh_at ? `${t('table.lastRefresh')}：${fmtDateTime(acc.last_refresh_at)}` : `${t('table.lastRefresh')}：${t('common.none')}`
  return (
    // 鼠标点行里任何空白处都打开抽屉（地址、验证码、按钮各自拦住冒泡）；键盘 / 读屏走垫底的那个打开按钮
    <div
      className={`mh-arow ${dead ? 'is-dead' : ''}`}
      onClick={(e) => {
        // 先把焦点放到这一行的打开按钮上：抽屉关闭后焦点回到这里，而不是丢到页面顶部
        e.currentTarget.querySelector('.mh-arow__open')?.focus({ preventScroll: true })
        onOpen(acc)
      }}
    >
      <button
        type="button"
        className="mh-arow__open"
        onClick={(e) => {
          e.stopPropagation()
          onOpen(acc)
        }}
        aria-haspopup="dialog"
        aria-label={t('hm.row.open', { email: acc.email })}
      />
      <div className="mh-arow__email">
        <CopyAddr email={acc.email} q={q} />
        {(acc.alias_count > 1 || acc.note) && (
          <span className="mh-arow__sub">
            {acc.alias_count > 1 && (
              <span className="mh-mini">
                <Tags size={11} aria-hidden />
                {t('table.aliasBadge', { n: acc.alias_count })}
              </span>
            )}
            {acc.note && (
              <span className="mh-arow__note" title={acc.note}>
                <StickyNote size={11} aria-hidden />
                <span>{acc.note}</span>
              </span>
            )}
          </span>
        )}
      </div>
      <div className="mh-arow__status">
        <AccountStatus acc={acc} title={refreshed} />
      </div>
      <div className="mh-arow__group">
        {acc.group_name ? (
          <span className="mh-chip" title={acc.group_name}>
            {acc.group_name}
          </span>
        ) : (
          <span className="mh-dash" aria-hidden>
            —
          </span>
        )}
      </div>
      <time className="mh-arow__time" dateTime={acc.last_mail_at || undefined} title={fmtDateTime(acc.last_mail_at) || ''}>
        <Clock size={12} className="mh-arow__time-icon" aria-hidden />
        {acc.last_mail_at ? fmtRelative(acc.last_mail_at, locale, now) : t('common.none')}
      </time>
      {/* 窄屏：验证码 + 操作并成一整行；宽屏 display: contents，各占一列 */}
      <div className="mh-arow__foot">
        <div className="mh-arow__code">
          <CodeCell
            code={fetched || acc.last_code}
            stale={stale}
            query={q}
            staleTitle={stale ? t('code.history.hint', { ago: acc.last_code_at ? fmtRelative(acc.last_code_at, locale, now) : '' }) : undefined}
          />
        </div>
        <div className="mh-arow__acts">
          <ActBtn icon={KeyRound} label={t('action.code')} showLabel tone="accent" busy={busy === 'code'} onClick={() => onCode(acc)} />
          <ActBtn icon={RotateCw} label={t('action.refresh')} busy={busy === 'refresh'} onClick={() => onRefresh(acc)} />
          <ActBtn icon={ArrowUpRight} label={t('action.enter')} to={`/hotmail/accounts/${acc.id}`} />
          <ActBtn icon={Trash2} label={`${t('action.delete')} ${acc.email}`} tone="danger" busy={busy === 'delete'} onClick={() => onDelete(acc)} />
        </div>
      </div>
    </div>
  )
})


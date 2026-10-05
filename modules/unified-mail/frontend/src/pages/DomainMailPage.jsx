import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock,
  Globe,
  Inbox,
  Info,
  KeyRound,
  Layers,
  MailPlus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { fmtDateTime, fmtRelative } from '../lib/format.js'
import { useNow } from '../lib/motion.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { PageHeader, mergeGroupCounts, useUpstreams } from '../components/hub.jsx'
import { ComposeMailDialog } from '../components/ComposeMailDialog.jsx'
import { MailboxMetaDialog } from '../components/MailboxMetaDialog.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { VirtualList } from '../components/VirtualList.jsx'
import { SearchCommand } from '../components/overview/SearchCommand.jsx'
import { Count, StatusLight } from '../components/overview/StatCard.jsx'
import { CreateMailboxDialog } from '../components/domain/CreateMailboxDialog.jsx'
import { ActBtn, CodeCell, CopyAddr, GroupSelect, Note, StatusPill, rowSpotlight, tiltReset, tiltSpot } from '../components/work.jsx'

const ALL = '*'

function patchParams(params, patch) {
  const next = new URLSearchParams(params)
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k)
    else next.set(k, v)
  }
  return next
}

const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || ''
const ts = (iso) => Date.parse(iso || '') || 0

/** 信箱归到哪个域名：已启用域名本身或它的子域都算它的；归不上的按信箱自己的域名单列 */
function makeRootOf(domains) {
  const roots = [...new Set(domains.map((d) => String(d).toLowerCase()))].sort((a, b) => b.length - a.length)
  return (email) => {
    const dom = domainOf(email)
    return roots.find((r) => dom === r || dom.endsWith(`.${r}`)) || dom
  }
}

/* 域名邮箱（干活层）。两层，同一个地址（/domain）：
   第一层 —— 每个域名一张卡（信箱数、最近来信、带验证码的信箱数），悬停轻微倾斜 + 聚光；第一张是「全部信箱」。
   第二层 —— ?d=<域名>（或 * = 全部）：这个域名下的信箱列表，行多时虚拟滚动；搜索时直接进第二层看全部域名里的结果。
   数据与改版前相同：信箱列表只取一次（limit 1000），搜索、分组、按域名分都在前端对这一份做，
   不为卡片或搜索另发请求（云端每多一次列表请求就多一次 D1 聚合查询）。只有列表超出单次上限时，搜索才交给后端。
   近 7 天收信折线：现有接口只给每个信箱的「最近来信时间」和总邮件数，算不出逐日数量，所以不做。
   本地版 / 云端版差异照旧：云端没有「移出邮箱簿」，「登记」只出现在云端收信自动建的信箱上。 */
export default function DomainMailPage() {
  const { t, tn, locale } = useLocale()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const now = useNow(30_000)

  const q = (params.get('q') || '').trim()
  const group = (params.get('group') || '').trim()
  const d = (params.get('d') || '').trim().toLowerCase()
  const layer2 = Boolean(d) || q !== ''

  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [truncated, setTruncated] = useState(false)
  const [serverHits, setServerHits] = useState(null)
  const [domains, setDomains] = useState({ domains: [], cfmail_configured: true })
  const { upstreams, state: upState, workerDiscovery, reload: reloadUp } = useUpstreams()
  const [rowBusy, setRowBusy] = useState({})
  const [rowCode, setRowCode] = useState({})
  const [composeOpen, setComposeOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const setParam = useCallback((patch) => setParams((prev) => patchParams(prev, patch), { replace: true }), [setParams])

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' || s === 'refreshing' ? 'refreshing' : 'loading'))
    try {
      const res = await hubApi.mailboxes({ source: 'domain', limit: 1000 })
      setTruncated(!!res.truncated)
      setRows(res.rows || [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])
  const loadDomains = useCallback(async () => {
    try {
      setDomains(await hubApi.domains())
    } catch {
      /* 非致命：拿不到域名白名单时保留页面其余功能 */
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    loadDomains()
  }, [loadDomains])

  // 列表超出单次上限（看不到全部）时，搜索才交给后端，和改版前一样按关键词查
  useEffect(() => {
    if (!truncated || !q) {
      setServerHits(null)
      return undefined
    }
    let cancelled = false
    hubApi
      .mailboxes({ q, source: 'domain', limit: 1000 })
      .then((r) => !cancelled && setServerHits(r.rows || []))
      .catch(() => !cancelled && setServerHits(null))
    return () => {
      cancelled = true
    }
  }, [truncated, q])

  /* ── 派生 ── */
  const domainList = useMemo(() => domains.domains || [], [domains])
  const rootOf = useMemo(() => makeRootOf(domainList), [domainList])
  const inGroup = useCallback((r) => !group || (r.group || '').trim() === group, [group])

  const cards = useMemo(() => {
    const map = new Map(domainList.map((dm) => [dm.toLowerCase(), { domain: dm.toLowerCase(), count: 0, last: '', withCode: 0, auto: 0 }]))
    const all = { domain: ALL, count: 0, last: '', withCode: 0, auto: 0 }
    for (const r of rows) {
      if (!inGroup(r)) continue
      const root = rootOf(r.email)
      const c = map.get(root) || { domain: root, count: 0, last: '', withCode: 0, auto: 0 }
      for (const x of [c, all]) {
        x.count += 1
        if (ts(r.last_mail_at) > ts(x.last)) x.last = r.last_mail_at
        if (r.last_code) x.withCode += 1
        if (r.status === 'auto') x.auto += 1
      }
      map.set(root, c)
    }
    const list = [...map.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    return [all, ...list]
  }, [rows, domainList, rootOf, inGroup])

  const byDomain = useMemo(() => {
    const base = serverHits ?? rows
    return d && d !== ALL ? base.filter((r) => rootOf(r.email) === d) : base
  }, [serverHits, rows, d, rootOf])
  const visible = useMemo(() => {
    const ql = q.toLowerCase()
    return byDomain.filter(
      (r) => inGroup(r) && (!ql || serverHits || [r.email, r.label, r.group].some((x) => (x || '').toLowerCase().includes(ql))),
    )
  }, [byDomain, inGroup, q, serverHits])
  const groupOpts = useMemo(
    () => mergeGroupCounts([(layer2 ? byDomain : rows).map((r) => ({ name: r.group, count: 1 }))], group),
    [layer2, byDomain, rows, group],
  )

  /* ── 行操作（与改版前相同的调用）── */
  const busyOn = (key, v) => setRowBusy((m) => ({ ...m, [key]: v }))
  const handlers = useRef({})
  handlers.current = {
    code: async (row) => {
      busyOn(row.email, 'code')
      try {
        const res = await hubApi.code(row.email, 'domain')
        setRowCode((m) => ({ ...m, [row.email]: res }))
        if (res.found) toast.success(t('code.result.found'))
        else toast.info(res.error || t('code.result.none'))
        load()
      } catch (err) {
        toast.error(err?.userMessage || t('common.error'))
      } finally {
        busyOn(row.email, undefined)
      }
    },
    register: async (row) => {
      busyOn(row.email, 'register')
      try {
        const at = row.email.lastIndexOf('@')
        await hubApi.createMailbox({ name: row.email.slice(0, at), domain: row.email.slice(at + 1) })
        toast.success(t('dom.registered'))
        await load()
      } catch (err) {
        toast.error(err?.userMessage || t('common.error'))
      } finally {
        busyOn(row.email, undefined)
      }
    },
    remove: async (row) => {
      if (!window.confirm(`${t('dom.remove.confirm')}\n${row.email}`)) return
      busyOn(row.email, 'remove')
      try {
        await hubApi.unregisterMailbox(row.email)
        toast.info(t('dom.removed'))
        load()
      } catch (err) {
        toast.error(err?.userMessage || t('common.error'))
      } finally {
        busyOn(row.email, undefined)
      }
    },
    mails: (row) => navigate(`/?q=${encodeURIComponent(row.email)}`), // 收件箱已并进统一总览：按这个地址搜最近邮件
    edit: (row) => setEditing(row),
  }
  const act = useMemo(
    () => ({
      code: (r) => handlers.current.code(r),
      register: (r) => handlers.current.register(r),
      remove: (r) => handlers.current.remove(r),
      mails: (r) => handlers.current.mails(r),
      edit: (r) => handlers.current.edit(r),
    }),
    [],
  )
  const onMetaSaved = (next) => setRows((cur) => cur.map((row) => (row.email === next.email ? { ...row, ...next } : row)))

  /* ── 导航：进入某个域名推一条历史（浏览器后退回到卡片） ── */
  const hrefFor = (dom) => {
    const s = patchParams(params, { d: dom, q: '' }).toString()
    return s ? `/domain?${s}` : '/domain'
  }
  const backToCards = () => setParam({ d: '', q: '' })

  const spot = useMemo(() => rowSpotlight('.mh-mrow'), [])
  const renderItem = useCallback(
    (r) => (
      <MailboxRow r={r} busy={rowBusy[r.email]} fresh={rowCode[r.email]} q={q} now={now} locale={locale} t={t} act={act} />
    ),
    [rowBusy, rowCode, q, now, locale, t, act],
  )
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1100

  /* ── 上游状态条 ── */
  const upLabel = (u) =>
    u.ok ? t('up.ok') : u.detail?.includes('未配置') || u.detail?.includes('密钥') ? t('up.unconfigured') : t('up.down')
  const statusBar = (
    <div className="mh-upbar">
      <span className="mh-upbar__title">{t('up.title')}</span>
      {upState === 'loading' && <span className="mh-upbar__item">{t('common.loading')}</span>}
      {upstreams.map((u) => {
        const hint = t(u.source === 'hotmail' ? 'up.hotmail.hint' : 'up.domain.hint')
        return (
          <span key={u.source} className={`mh-upbar__item ${u.ok ? '' : 'is-warn'}`} title={u.detail ? `${hint}\n${u.detail}` : hint}>
            <StatusLight tone={u.ok ? 'ok' : 'warn'} label={`${t(u.source === 'hotmail' ? 'src.hotmail' : 'src.domain')} · ${upLabel(u)}`} />
            <span aria-hidden>{t(u.source === 'hotmail' ? 'src.hotmail' : 'src.domain')}</span>
            <b aria-hidden>{upLabel(u)}</b>
          </span>
        )
      })}
      {!IS_CLOUD && upState === 'ready' && workerDiscovery === false && (
        <span className="mh-upbar__item is-warn" title={t('up.worker.legacy.hint')}>
          <AlertTriangle size={13} aria-hidden />
          <b>{t('up.worker.legacy')}</b>
        </span>
      )}
      <button type="button" className="mh-icon-btn mh-upbar__retry" onClick={reloadUp} aria-label={t('up.retry')} title={t('up.retry')}>
        <RefreshCw size={15} className={upState === 'loading' ? 'mh-spin' : ''} aria-hidden />
      </button>
    </div>
  )

  const registryNote = (
    <Note icon={workerDiscovery === false ? AlertTriangle : Info} tone={workerDiscovery === false ? 'warn' : 'info'}>
      {t(workerDiscovery === false ? 'dom.legacyNote' : IS_CLOUD ? 'dom.registryNote.cloud' : 'dom.registryNote')}
      {truncated ? ` · ${t('dom.truncated')}` : ''}
    </Note>
  )

  /* ── 第一层：域名卡片 ── */
  let layer
  if (!layer2) {
    if (state === 'loading') {
      layer = <EnvelopeSkeleton rows={4} label={t('common.loading')} className="mh-skel--page" />
    } else if (state === 'error' && rows.length === 0) {
      layer = (
        <section className="mh-card">
          <EmptyState
            pose="search"
            tone="danger"
            icon={AlertTriangle}
            title={t('dm.errorTitle')}
            desc={t('dm.errorDesc')}
            action={
              <button type="button" className="mh-btn mh-btn--ghost" onClick={load}>
                <RotateCcw size={14} aria-hidden />
                {t('common.retry')}
              </button>
            }
          />
        </section>
      )
    } else if (rows.length === 0 && domainList.length === 0) {
      layer = (
        <section className="mh-card">
          <EmptyState
            pose="wait"
            title={t('dm.emptyTitle')}
            desc={t('dom.empty')}
            action={
              <button type="button" className="mh-btn mh-btn--primary" onClick={() => setCreateOpen(true)}>
                <MailPlus size={15} aria-hidden />
                {t('dom.add.create')}
              </button>
            }
          />
        </section>
      )
    } else {
      layer = (
        <section className="mh-dcards-wrap" aria-labelledby="mh-dc-title">
          <h2 id="mh-dc-title" className="sr-only">
            {t('dm.cards.title')}
          </h2>
          <ul className={`mh-dcards ${state === 'refreshing' ? 'is-busy' : ''}`}>
            {cards.map((c, i) => (
              <li key={c.domain} style={{ '--i': i }}>
                <Link
                  to={hrefFor(c.domain)}
                  className={`mh-dcard ${c.domain === ALL ? 'is-all' : ''} ${c.count === 0 ? 'is-empty' : ''}`}
                  onMouseMove={tiltSpot}
                  onMouseLeave={tiltReset}
                >
                  <span className="mh-dcard__head">
                    {c.domain === ALL ? <Layers size={15} aria-hidden /> : <Globe size={15} aria-hidden />}
                    <span className="mh-dcard__name">{c.domain === ALL ? t('dm.cards.all') : c.domain}</span>
                    <ArrowRight size={15} className="mh-dcard__go" aria-hidden />
                  </span>
                  <span className="mh-dcard__count">
                    <Count value={c.count} />
                    <span className="mh-dcard__unit">{t('dm.cards.unit')}</span>
                  </span>
                  <span className="mh-dcard__meta">
                    <span title={fmtDateTime(c.last) || ''}>
                      <Clock size={12} aria-hidden />
                      {c.last ? t('dm.cards.last', { rel: fmtRelative(c.last, locale, now) }) : t('dm.cards.noMail')}
                    </span>
                    {c.withCode > 0 && (
                      <span>
                        <KeyRound size={12} aria-hidden />
                        {t('dm.cards.withCode', { n: c.withCode })}
                      </span>
                    )}
                  </span>
                  {c.count === 0 && group && <span className="mh-dcard__hint">{t('dm.cards.noneInGroup')}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {registryNote}
        </section>
      )
    }
  } else {
    /* ── 第二层：信箱列表 ── */
    const title = q && !d ? t('dm.list.searchTitle') : d === ALL || !d ? t('dm.cards.all') : d
    let body
    if (state === 'loading') body = <EnvelopeSkeleton rows={6} label={t('common.loading')} />
    else if (state === 'error' && rows.length === 0)
      body = (
        <EmptyState
          pose="search"
          tone="danger"
          icon={AlertTriangle}
          title={t('dm.errorTitle')}
          desc={t('dm.errorDesc')}
          action={
            <button type="button" className="mh-btn mh-btn--ghost" onClick={load}>
              <RotateCcw size={14} aria-hidden />
              {t('common.retry')}
            </button>
          }
        />
      )
    else if (visible.length === 0)
      body =
        byDomain.length > 0 || q ? (
          <EmptyState
            pose="search"
            title={t('dom.empty.filtered')}
            desc={t('dm.list.emptyFilteredDesc')}
            action={
              <button type="button" className="mh-btn mh-btn--ghost" onClick={() => setParam({ q: '', group: '' })}>
                <RotateCcw size={14} aria-hidden />
                {t('ov.filter.resetAll')}
              </button>
            }
          />
        ) : (
          <EmptyState
            pose="wait"
            title={t('dm.list.emptyTitle')}
            desc={t('dom.empty')}
            action={
              <button type="button" className="mh-btn mh-btn--primary" onClick={() => setCreateOpen(true)}>
                <MailPlus size={15} aria-hidden />
                {t('dom.add.create')}
              </button>
            }
          />
        )
    else
      body = (
        <VirtualList
          items={visible}
          getKey={(r) => r.email}
          estimateSize={wide ? 60 : 136}
          renderItem={renderItem}
          className={state === 'refreshing' ? 'is-busy' : ''}
          label={t('dm.list.label', { name: title })}
          onMouseMove={spot}
        />
      )

    layer = (
      <section className="mh-card mh-atable mh-mtable" aria-labelledby="mh-mt-title">
        <header className="mh-atable__head">
          <div className="mh-crumbs">
            <button type="button" className="mh-linkbtn mh-crumbs__back" onClick={backToCards}>
              <ArrowLeft size={14} aria-hidden />
              {t('dm.list.back')}
            </button>
            <h2 id="mh-mt-title" className={`mh-h2 ${d && d !== ALL ? 'is-mono' : ''}`}>
              {title}
            </h2>
          </div>
          {state !== 'loading' && <p className="mh-atable__count">{tn('dom.count', visible.length)}</p>}
        </header>
        {state === 'error' && rows.length > 0 && (
          <p className="mh-timeline__warn" role="status">
            <AlertTriangle size={14} aria-hidden />
            {t('dm.refreshFailed')}
            <button type="button" className="mh-linkbtn" onClick={load}>
              {t('common.retry')}
            </button>
          </p>
        )}
        {visible.length > 0 && state !== 'loading' && (
          <div className="mh-mcols" aria-hidden>
            <span>{t('dom.col.email')}</span>
            <span>{t('meta.group')}</span>
            <span>{t('dom.col.lastMail')}</span>
            <span>{t('dom.col.lastCode')}</span>
            <span className="mh-acols__end">{t('table.actions')}</span>
          </div>
        )}
        {body}
        <footer className="mh-atable__foot">{registryNote}</footer>
      </section>
    )
  }

  return (
    <div className="mh-page">
      <PageHeader
        title={t('dom.title')}
        subtitle={t('dom.subtitle')}
        actions={
          <>
            <button type="button" className="mh-btn mh-btn--quiet" onClick={() => setComposeOpen(true)}>
              <Send size={15} aria-hidden />
              {t('compose.open')}
            </button>
            <button type="button" className="mh-btn mh-btn--primary" onClick={() => setCreateOpen(true)}>
              <MailPlus size={15} aria-hidden />
              {t('dom.add.create')}
            </button>
          </>
        }
      />

      {statusBar}

      {!domains.cfmail_configured && (
        <p className="mh-banner mh-banner--warn">
          <AlertTriangle size={15} aria-hidden />
          <span>{t('dom.unconfigured')}</span>
        </p>
      )}

      <section className="mh-card mh-tool" aria-label={t('dm.tools')}>
        <SearchCommand
          compact
          value={q}
          onSearch={(v) => setParam({ q: v })}
          placeholder={t('dm.search.placeholder')}
          label={t('overview.search')}
          resultHint={layer2 && state === 'ready' ? tn('dom.count', visible.length) : undefined}
        />
        <div className="mh-tool__row">
          <GroupSelect groups={groupOpts} value={group} onChange={(g) => setParam({ group: g })} />
          {(q || group) && (
            <button type="button" className="mh-linkbtn" onClick={() => setParam({ q: '', group: '' })}>
              <RotateCcw size={13} aria-hidden />
              {t('ov.filter.reset')}
            </button>
          )}
          {!layer2 && state === 'ready' && (
            <span className="mh-tool__hint">{tn('dom.count', cards[0]?.count || 0)}</span>
          )}
        </div>
      </section>

      {layer}

      <ComposeMailDialog open={composeOpen} onClose={() => setComposeOpen(false)} />
      <MailboxMetaDialog mailbox={editing} onClose={() => setEditing(null)} onSaved={onMetaSaved} />
      <CreateMailboxDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        domains={domainList}
        defaultDomain={d && d !== ALL ? d : ''}
        configured={domains.cfmail_configured}
        onCreated={load}
      />
    </div>
  )
}

const STATUS_PILL = {
  discovered: ['info', 'dom.status.discovered'],
  auto: ['ok', 'dom.status.auto'],
  'local-only': ['warn', 'dom.status.localOnly'],
}

/* 单行：memo 包裹。整行可点 = 编辑备注 / 分组（与改版前一致）；地址、验证码、操作按钮叠在上面各管各的。 */
const MailboxRow = memo(function MailboxRow({ r, busy, fresh, q, now, locale, t, act }) {
  const code = fresh?.found ? fresh.code : r.last_code
  const pill = STATUS_PILL[r.status]
  return (
    <div
      className="mh-mrow"
      onClick={(e) => {
        e.currentTarget.querySelector('.mh-arow__open')?.focus({ preventScroll: true })
        act.edit(r)
      }}
    >
      <button
        type="button"
        className="mh-arow__open"
        onClick={(e) => {
          e.stopPropagation()
          act.edit(r)
        }}
        aria-haspopup="dialog"
        aria-label={t('dom.edit.rowLabel', { email: r.email })}
      />
      <div className="mh-mrow__email">
        <span className="mh-mrow__addr">
          <CopyAddr email={r.email} q={q} />
          {pill && <StatusPill tone={pill[0]}>{t(pill[1])}</StatusPill>}
        </span>
        {r.label && (
          <span className="mh-arow__note" title={r.label}>
            <span>{r.label}</span>
          </span>
        )}
      </div>
      <div className="mh-arow__group">
        {r.group ? (
          <span className="mh-chip" title={r.group}>
            {r.group}
          </span>
        ) : (
          <span className="mh-dash" aria-hidden>
            —
          </span>
        )}
      </div>
      <time className="mh-arow__time" dateTime={r.last_mail_at || undefined} title={fmtDateTime(r.last_mail_at) || ''}>
        <Clock size={12} className="mh-arow__time-icon" aria-hidden />
        {r.last_mail_at ? fmtRelative(r.last_mail_at, locale, now) : t('common.none')}
      </time>
      <div className="mh-arow__foot">
        <div className="mh-arow__code">
          <CodeCell code={code} query={q} />
        </div>
        <div className="mh-arow__acts">
          {IS_CLOUD && r.status === 'auto' && (
            <ActBtn icon={MailPlus} label={t('dom.register')} busy={busy === 'register'} onClick={() => act.register(r)} />
          )}
          <ActBtn icon={KeyRound} label={t('dom.getCode')} showLabel tone="accent" busy={busy === 'code'} onClick={() => act.code(r)} />
          <ActBtn icon={Inbox} label={t('dom.viewMails')} onClick={() => act.mails(r)} />
          <ActBtn icon={Pencil} label={t('dom.edit.title')} onClick={() => act.edit(r)} aria-haspopup="dialog" />
          {/* 低频操作：只有本地版有「邮箱簿」可移出；云端版没有这个按钮 */}
          {hubApi.supportsLocalRegistry && (
            <ActBtn icon={Trash2} label={`${t('dom.remove')} ${r.email}`} tone="danger" busy={busy === 'remove'} onClick={() => act.remove(r)} />
          )}
        </div>
      </div>
    </div>
  )
})

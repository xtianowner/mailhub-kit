import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  History,
  Info,
  KeyRound,
  Mail,
  MailWarning,
  Pencil,
  RotateCcw,
  RotateCw,
  StickyNote,
  Tags,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format.js'
import { useNow } from '../lib/motion.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useCopy } from '../lib/useCopy.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { CodeChip } from '../components/overview/CodeChip.jsx'
import { AccountStatus, ActBtn, CodeCell, CopyAddr, StatusPill } from '../components/work.jsx'

// 轮询间隔下限 5 秒，避免设置里填了极小值把接口打爆（与改版前相同）。
const POLL_FLOOR_S = 5
function parsePollSeconds(raw) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return 15
  return Math.max(POLL_FLOOR_S, n)
}

/* Hotmail 单个账号的完整页（/hotmail/accounts/:id）。功能与改版前完全一致：
   接码（成功自动复制）、自动刷新邮件（间隔取设置、下限 5 秒，开关照旧）、新验证码提示、备注与分组编辑、
   验证码历史（展开时才取）、别名定向接码、邮件列表的前端筛选（只看带验证码 / 标签 / 发件域名）。
   只换呈现：桌面端左栏是接码与邮件，右栏是备注、历史、别名；窄屏按同样顺序堆叠。 */
export default function AccountPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useLocale()
  const toast = useToast()
  const copy = useCopy()
  const now = useNow(30_000)

  const [acc, setAcc] = useState(null)
  const [accState, setAccState] = useState('loading')
  const [msgs, setMsgs] = useState([])
  const [msgState, setMsgState] = useState('loading')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeRes, setCodeRes] = useState(null)

  // ── 邮件列表的前端筛选（不发请求）──
  const [codeOnly, setCodeOnly] = useState(false)
  const [selTags, setSelTags] = useState(() => new Set())
  const [selSenders, setSelSenders] = useState(() => new Set())

  // ── 自动刷新 ──
  const [autoOn, setAutoOn] = useState(true)
  const [pollSec, setPollSec] = useState(15)
  const seenCodesRef = useRef(null) // 已见过的验证码；首次加载前为 null
  const pollRef = useRef(null)

  const loadAcc = useCallback(async () => {
    setAccState('loading')
    try {
      setAcc(await api.account(id))
      setAccState('ready')
    } catch (e) {
      setAccState(e.status === 404 ? 'notfound' : 'error')
    }
  }, [id])

  // silent=true：轮询用，不出加载态；首次加载后若出现新验证码就提示
  const loadMsgs = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setMsgState('loading')
      try {
        const res = await api.messages(id, 30)
        const list = (res.messages || []).slice().sort((a, b) => {
          const ta = a.received_at ? Date.parse(a.received_at) : 0
          const tb = b.received_at ? Date.parse(b.received_at) : 0
          return tb - ta
        })
        const codes = list.map((m) => m.verification_code).filter(Boolean)
        if (seenCodesRef.current === null) {
          seenCodesRef.current = new Set(codes)
        } else {
          const fresh = codes.find((c) => !seenCodesRef.current.has(c))
          if (fresh) toast.success(t('account.code.newCode', { code: fresh }))
          for (const c of codes) seenCodesRef.current.add(c)
        }
        setMsgs(list)
        setMsgState('ready')
      } catch {
        if (!silent) setMsgState('error')
      }
    },
    [id, t, toast],
  )

  useEffect(() => {
    seenCodesRef.current = null
    setCodeOnly(false)
    setSelTags(new Set())
    setSelSenders(new Set())
  }, [id])

  useEffect(() => {
    loadAcc()
    loadMsgs()
  }, [loadAcc, loadMsgs])

  useEffect(() => {
    let cancelled = false
    api
      .settings()
      .then((s) => {
        if (!cancelled) setPollSec(parsePollSeconds(s?.poll_interval_seconds))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isDeadAcc = acc?.status === 'dead'
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!autoOn || isDeadAcc) return undefined
    pollRef.current = setInterval(() => loadMsgs({ silent: true }), pollSec * 1000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [autoOn, pollSec, isDeadAcc, loadMsgs])

  const onGetCode = async () => {
    setCodeBusy(true)
    try {
      const res = await api.getCode(id)
      setCodeRes(res)
      if (res.dead) {
        toast.error(t('status.dead'))
      } else if (!res.found) {
        toast.info(t('account.code.none'))
      } else if (res.code) {
        await copy(res.code, { successMsg: t('account.code.copied', { code: res.code }) })
      } else {
        toast.success(t('account.code.found'))
      }
      loadMsgs()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setCodeBusy(false)
    }
  }

  const tagFacets = useMemo(() => {
    const seen = new Set()
    for (const m of msgs) for (const tg of m.tags || []) if (tg) seen.add(tg)
    return [...seen].sort()
  }, [msgs])
  const senderFacets = useMemo(() => {
    const counts = new Map()
    for (const m of msgs) {
      const dom = senderDomain(m.from_address)
      if (!dom) continue
      counts.set(dom, (counts.get(dom) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([dom]) => dom)
  }, [msgs])
  const filteredMsgs = useMemo(
    () =>
      msgs.filter((m) => {
        if (codeOnly && !m.verification_code) return false
        if (selTags.size > 0 && !(m.tags || []).some((tg) => selTags.has(tg))) return false
        if (selSenders.size > 0) {
          const dom = senderDomain(m.from_address)
          if (!dom || !selSenders.has(dom)) return false
        }
        return true
      }),
    [msgs, codeOnly, selTags, selSenders],
  )
  const filterActive = codeOnly || selTags.size > 0 || selSenders.size > 0
  const toggleSet = (setter) => (val) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return next
    })
  const clearFilters = () => {
    setCodeOnly(false)
    setSelTags(new Set())
    setSelSenders(new Set())
  }

  if (accState === 'loading') return <EnvelopeSkeleton rows={5} label={t('common.loading')} className="mh-skel--page" />
  if (accState === 'notfound' || accState === 'error' || !acc) {
    const nf = accState === 'notfound'
    return (
      <section className="mh-card">
        <EmptyState
          pose="search"
          tone={nf ? undefined : 'danger'}
          icon={nf ? undefined : AlertTriangle}
          title={t(nf ? 'account.notFound' : 'common.error')}
          action={
            <>
              {!nf && (
                <button type="button" className="mh-btn mh-btn--ghost" onClick={loadAcc}>
                  <RotateCcw size={14} aria-hidden />
                  {t('common.retry')}
                </button>
              )}
              <button type="button" className="mh-btn mh-btn--quiet" onClick={() => navigate('/hotmail')}>
                <ArrowLeft size={15} aria-hidden />
                {t('hm.backToList')}
              </button>
            </>
          }
        />
      </section>
    )
  }

  const isDead = acc.status === 'dead'
  const rt =
    acc.rt_days_left === null || acc.rt_days_left === undefined
      ? t('table.never')
      : acc.rt_days_left < 0
        ? t('table.expired')
        : `${acc.rt_days_left} ${t('table.days')}`
  const stale = acc.code_fresh === false && !!acc.last_code

  return (
    <div className="mh-page">
      <Link to="/hotmail" className="mh-btn mh-btn--quiet mh-btn--sm mh-self-start">
        <ArrowLeft size={15} aria-hidden />
        {t('hm.backToList')}
      </Link>

      <section className="mh-card mh-acchead" aria-labelledby="mh-acc-title">
        <div className="mh-acchead__top">
          <h1 id="mh-acc-title" className="sr-only">
            {acc.email}
          </h1>
          <CopyAddr email={acc.email} className="mh-addr--xl" />
          <span className="mh-acchead__badges">
            <AccountStatus acc={acc} />
            {acc.alias_count > 1 && (
              <StatusPill tone="info" dot={false}>
                <Tags size={11} aria-hidden />
                {t('table.aliasBadge', { n: acc.alias_count })}
              </StatusPill>
            )}
          </span>
        </div>
        <dl className="mh-facts mh-facts--row">
          <div>
            <dt>{t('account.rtExpires')}</dt>
            <dd>
              {rt}
              {acc.rt_expires_at && <span className="mh-facts__sub">{fmtDate(acc.rt_expires_at)}</span>}
            </dd>
          </div>
          <div>
            <dt>{t('account.lastRefresh')}</dt>
            <dd>{acc.last_refresh_at ? fmtDateTime(acc.last_refresh_at) : t('common.none')}</dd>
          </div>
          <div>
            <dt>{t('hm.col.lastMail')}</dt>
            <dd title={fmtDateTime(acc.last_mail_at) || ''}>{acc.last_mail_at ? fmtRelative(acc.last_mail_at, locale, now) : t('common.none')}</dd>
          </div>
          <div>
            <dt>{t('table.lastCode')}</dt>
            <dd>
              <CodeCell
                code={acc.last_code}
                stale={stale}
                staleTitle={stale ? t('code.history.hint', { ago: acc.last_code_at ? fmtRelative(acc.last_code_at, locale, now) : '' }) : undefined}
              />
            </dd>
          </div>
        </dl>
        {isDead && (
          <p className="mh-banner mh-banner--danger" role="status">
            <AlertTriangle size={15} aria-hidden />
            <span>{t('account.deadBanner')}</span>
          </p>
        )}
      </section>

      <div className="mh-acclayout">
        <div className="mh-acclayout__main">
          {/* 接码 */}
          <section className="mh-card mh-sec" aria-labelledby="mh-sec-code">
            <header className="mh-sec__head">
              <h2 id="mh-sec-code" className="mh-h2">
                <KeyRound size={15} aria-hidden />
                {t('hm.acc.getCode')}
              </h2>
              <span className="mh-sec__tools">
                <AutoRefreshSwitch on={autoOn} onToggle={() => setAutoOn((v) => !v)} sec={pollSec} t={t} disabled={isDead} />
                <button type="button" className="mh-btn mh-btn--primary" onClick={onGetCode} disabled={codeBusy || isDead}>
                  {codeBusy ? <span className="mh-btn__spin" aria-hidden /> : <KeyRound size={15} aria-hidden />}
                  {t('account.getCode.btn')}
                </button>
              </span>
            </header>
            <p className="mh-note mh-note--info">
              <Info size={14} aria-hidden />
              <span>{t('account.code.hint')}</span>
            </p>
            {codeRes && (
              <div className="mh-coderesult" role="status">
                {codeRes.found && codeRes.code ? (
                  <>
                    <CodeChip code={codeRes.code} size="lg" />
                    {codeRes.message?.subject && <span className="mh-coderesult__sub">{codeRes.message.subject}</span>}
                  </>
                ) : (
                  <span className="mh-coderesult__sub">{codeRes.dead ? t('account.deadBanner') : t('account.code.none')}</span>
                )}
                {codeRes.links?.length > 0 && (
                  <span className="mh-linklist">
                    <span className="mh-detail__section">{t('account.code.links')}</span>
                    {codeRes.links.map((l, i) => (
                      <a key={i} href={l} target="_blank" rel="noreferrer" title={l}>
                        <ExternalLink size={12} aria-hidden />
                        <span>{l}</span>
                      </a>
                    ))}
                  </span>
                )}
              </div>
            )}
          </section>

          {/* 邮件列表 */}
          <section className="mh-card mh-sec mh-sec--flush" aria-labelledby="mh-sec-mails">
            <header className="mh-sec__head">
              <h2 id="mh-sec-mails" className="mh-h2">
                <Mail size={15} aria-hidden />
                {t('account.mails')}
              </h2>
              <button type="button" className="mh-btn mh-btn--quiet mh-btn--sm" onClick={() => loadMsgs()} disabled={msgState === 'loading'}>
                <RotateCw size={14} className={msgState === 'loading' ? 'mh-spin' : ''} aria-hidden />
                {t('account.mails.refresh')}
              </button>
            </header>
            {msgState === 'ready' && msgs.length > 0 && (
              <div className="mh-fbar">
                <div className="mh-fbar__chips">
                  <FilterChip active={codeOnly} onClick={() => setCodeOnly((v) => !v)}>
                    <KeyRound size={12} aria-hidden />
                    {t('mails.filter.codeOnly')}
                  </FilterChip>
                  {tagFacets.length > 0 && (
                    <>
                      <span className="mh-fbar__label">{t('mails.filter.tags')}</span>
                      {tagFacets.map((tg) => (
                        <FilterChip key={tg} active={selTags.has(tg)} onClick={() => toggleSet(setSelTags)(tg)} title={tg}>
                          {tg}
                        </FilterChip>
                      ))}
                    </>
                  )}
                  {senderFacets.length > 0 && (
                    <>
                      <span className="mh-fbar__label">{t('mails.filter.senders')}</span>
                      {senderFacets.map((dom) => (
                        <FilterChip key={dom} active={selSenders.has(dom)} onClick={() => toggleSet(setSelSenders)(dom)} title={dom}>
                          {dom}
                        </FilterChip>
                      ))}
                    </>
                  )}
                </div>
                <div className="mh-fbar__foot">
                  <span>{t('mails.filter.shown', { shown: filteredMsgs.length, total: msgs.length })}</span>
                  {filterActive && (
                    <button type="button" className="mh-linkbtn" onClick={clearFilters}>
                      <X size={13} aria-hidden />
                      {t('mails.filter.clear')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {msgState === 'loading' && <EnvelopeSkeleton rows={4} label={t('common.loading')} />}
            {msgState === 'error' && (
              <EmptyState
                pose="search"
                tone="danger"
                icon={AlertTriangle}
                title={t('common.error')}
                action={
                  <button type="button" className="mh-btn mh-btn--ghost" onClick={() => loadMsgs()}>
                    <RotateCcw size={14} aria-hidden />
                    {t('common.retry')}
                  </button>
                }
              />
            )}
            {msgState === 'ready' && msgs.length === 0 && <EmptyState pose="wait" title={t('account.mails.empty')} />}
            {msgState === 'ready' && msgs.length > 0 && filteredMsgs.length === 0 && (
              <EmptyState pose="search" title={t('mails.filter.noMatch')} />
            )}
            {msgState === 'ready' && filteredMsgs.length > 0 && (
              <ul className="mh-mlist mh-mlist--page">
                {filteredMsgs.map((m) => (
                  <li key={m.graph_message_id} className="mh-mlist__row">
                    <Link to={`/hotmail/accounts/${id}/messages/${m.graph_message_id}`} className="mh-mlist__open">
                      <span className={`mh-mlist__icon ${m.folder_name === 'junkemail' ? 'is-junk' : ''}`} aria-hidden>
                        {m.folder_name === 'junkemail' ? <MailWarning size={14} /> : <Mail size={14} />}
                      </span>
                      <span className="mh-mlist__main">
                        <span className="mh-mlist__subject">{m.subject || t('common.noSubject')}</span>
                        <span className="mh-mlist__from">
                          {m.folder_name === 'junkemail' && <span className="mh-mlist__junk">{t('folder.junk')}</span>}
                          {m.from_name || m.from_address || t('common.none')}
                        </span>
                      </span>
                      <time className="mh-mlist__time" dateTime={m.received_at || undefined} title={fmtDateTime(m.received_at) || ''}>
                        {m.received_at ? fmtRelative(m.received_at, locale, now) : ''}
                      </time>
                    </Link>
                    {m.verification_code && (
                      <span className="mh-mlist__code">
                        <CodeChip code={m.verification_code} size="sm" />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mh-acclayout__side">
          <MetaSection acc={acc} onUpdated={(next) => setAcc(next)} t={t} />
          <CodeHistorySection accountId={id} locale={locale} now={now} t={t} />
          <AliasSection accountId={id} locale={locale} now={now} t={t} />
        </div>
      </div>
    </div>
  )
}

/* ── 备注 + 分组 ── 查看 / 编辑；保存走 POST /accounts/{id}/meta，'' 清空该字段（与改版前相同） */
function MetaSection({ acc, onUpdated, t }) {
  const toast = useToast()
  const fid = useId()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(acc.note || '')
  const [group, setGroup] = useState(acc.group_name || '')
  const [busy, setBusy] = useState(false)

  const startEdit = () => {
    setNote(acc.note || '')
    setGroup(acc.group_name || '')
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    try {
      const next = await api.setMeta(acc.id, { note: note.trim(), group: group.trim() })
      onUpdated(next)
      setEditing(false)
      toast.success(t('meta.saved'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const hasMeta = !!(acc.note || acc.group_name)
  return (
    <section className="mh-card mh-sec" aria-labelledby={`${fid}-t`}>
      <header className="mh-sec__head">
        <h2 id={`${fid}-t`} className="mh-h2">
          <StickyNote size={15} aria-hidden />
          {t('meta.title')}
        </h2>
        {!editing && <ActBtn icon={Pencil} label={t('meta.edit')} showLabel onClick={startEdit} />}
      </header>
      {editing ? (
        <div className="mh-form">
          <div className="mh-field">
            <label className="mh-label" htmlFor={`${fid}-g`}>
              {t('meta.group')}
            </label>
            <input
              id={`${fid}-g`}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('meta.group.placeholder')}
              maxLength={64}
              className="mh-input"
            />
          </div>
          <div className="mh-field">
            <label className="mh-label" htmlFor={`${fid}-n`}>
              {t('meta.note')}
            </label>
            <textarea
              id={`${fid}-n`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('meta.note.placeholder')}
              rows={3}
              maxLength={500}
              className="mh-input mh-input--area"
            />
          </div>
          <div className="mh-form__actions mh-form__actions--end">
            <button type="button" className="mh-btn mh-btn--quiet mh-btn--sm" onClick={() => setEditing(false)} disabled={busy}>
              <X size={14} aria-hidden />
              {t('meta.cancel')}
            </button>
            <button type="button" className="mh-btn mh-btn--primary mh-btn--sm" onClick={save} disabled={busy}>
              {busy ? <span className="mh-btn__spin" aria-hidden /> : <Check size={14} aria-hidden />}
              {t('meta.save')}
            </button>
          </div>
        </div>
      ) : hasMeta ? (
        <div className="mh-metaview">
          {acc.group_name && (
            <span className="mh-chip">
              <Tags size={11} aria-hidden />
              {acc.group_name}
            </span>
          )}
          {acc.note && <p className="mh-metaview__note">{acc.note}</p>}
        </div>
      ) : (
        <p className="mh-sec__empty">{t('meta.empty')}</p>
      )}
    </section>
  )
}

/** from_address → 发件域名（发件人筛选胶囊用）。"noreply@tm.openai.com" → "tm.openai.com" */
function senderDomain(addr) {
  if (!addr || typeof addr !== 'string') return ''
  const i = addr.lastIndexOf('@')
  return (i >= 0 ? addr.slice(i + 1) : addr).trim().toLowerCase()
}

function FilterChip({ active, onClick, children, title }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={title} className={`mh-fchip ${active ? 'is-on' : ''}`}>
      {active && <Check size={12} aria-hidden />}
      <span className="mh-fchip__text">{children}</span>
    </button>
  )
}

/* ── 自动刷新开关：控制邮件列表的定时刷新（间隔取设置，下限 5 秒；与改版前同一套逻辑） ── */
function AutoRefreshSwitch({ on, onToggle, sec, t, disabled }) {
  const live = on && !disabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      onClick={onToggle}
      disabled={disabled}
      title={`${t('account.autoRefresh')} · ${sec}s`}
      className={`mh-switch ${live ? 'is-on' : ''}`}
    >
      <span className="mh-switch__track" aria-hidden>
        <span className="mh-switch__thumb" />
      </span>
      {t('account.autoRefresh')}
      {live && <span className="mh-switch__meta">{t('hm.acc.every', { sec })}</span>}
    </button>
  )
}

/* ── 验证码历史（折叠，展开时才取）── */
function CodeHistorySection({ accountId, locale, now, t }) {
  const [open, setOpen] = useState(false)
  const [codes, setCodes] = useState([])
  const [state, setState] = useState('idle')
  const loadedFor = useRef(null)
  const fid = useId()

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.codeHistory(accountId, 20)
      setCodes(res.codes || [])
      setState('ready')
      loadedFor.current = accountId
    } catch {
      setState('error')
    }
  }, [accountId])

  const onToggle = () => {
    const next = !open
    setOpen(next)
    if (next && loadedFor.current !== accountId) load()
  }

  return (
    <section className="mh-card mh-sec mh-sec--flush">
      <button type="button" className="mh-sec__toggle" onClick={onToggle} aria-expanded={open} aria-controls={`${fid}-b`}>
        <span className="mh-h2">
          <History size={15} aria-hidden />
          {t('history.title')}
          {state === 'ready' && codes.length > 0 && <span className="mh-mini">{codes.length}</span>}
        </span>
        <ChevronDown size={16} className={open ? 'is-flipped' : ''} aria-hidden />
      </button>
      {open && (
        <div id={`${fid}-b`} className="mh-sec__body">
          {state === 'loading' && <EnvelopeSkeleton rows={2} label={t('common.loading')} />}
          {state === 'error' && (
            <p className="mh-formerr mh-sec__pad" role="alert">
              <AlertTriangle size={15} aria-hidden />
              <span>{t('history.error')}</span>
              <button type="button" className="mh-linkbtn" onClick={load}>
                {t('common.retry')}
              </button>
            </p>
          )}
          {state === 'ready' && codes.length === 0 && <p className="mh-sec__empty mh-sec__pad">{t('history.empty')}</p>}
          {state === 'ready' && codes.length > 0 && (
            <ul className="mh-hist">
              {codes.map((m, i) => (
                <li key={m.graph_message_id || i} className="mh-hist__row">
                  <CodeChip code={m.verification_code} size="sm" />
                  <span className="mh-hist__main">
                    <span className="mh-hist__subject" title={m.subject || ''}>
                      {m.subject || t('common.noSubject')}
                    </span>
                    <span className="mh-hist__from">{m.from_address || m.from_name || t('common.none')}</span>
                  </span>
                  <time className="mh-hist__time" dateTime={m.received_at || undefined}>
                    {m.received_at ? fmtRelative(m.received_at, locale, now) : ''}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/* ── 别名：共享这个账号令牌的 plus 别名，各自按收件人定向接码（与账号级接码并存） ── */
function AliasSection({ accountId, locale, now, t }) {
  const [aliases, setAliases] = useState([])
  const [state, setState] = useState('loading')
  const fid = useId()

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.listAliases(accountId)
      setAliases(res.aliases || [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="mh-card mh-sec mh-sec--flush" aria-labelledby={`${fid}-t`}>
      <header className="mh-sec__head">
        <h2 id={`${fid}-t`} className="mh-h2">
          <Tags size={15} aria-hidden />
          {t('alias.title')}
          {state === 'ready' && aliases.length > 0 && <span className="mh-mini">{aliases.length}</span>}
        </h2>
      </header>
      <p className="mh-help mh-sec__pad">{t('alias.hint')}</p>
      {state === 'loading' && <EnvelopeSkeleton rows={2} label={t('common.loading')} />}
      {state === 'error' && (
        <p className="mh-formerr mh-sec__pad" role="alert">
          <AlertTriangle size={15} aria-hidden />
          <span>{t('alias.error')}</span>
          <button type="button" className="mh-linkbtn" onClick={load}>
            {t('common.retry')}
          </button>
        </p>
      )}
      {state === 'ready' && aliases.length === 0 && <p className="mh-sec__empty mh-sec__pad">{t('alias.empty')}</p>}
      {state === 'ready' && aliases.length > 0 && (
        <ul className="mh-alist">
          {aliases.map((a) => (
            <AliasRow key={a.id} alias={a} locale={locale} now={now} t={t} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AliasRow({ alias, locale, now, t }) {
  const toast = useToast()
  const copy = useCopy()
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)

  const onCode = async () => {
    setBusy(true)
    try {
      const r = await api.aliasCode(alias.id)
      setRes(r)
      // 取到就自动复制并提示「已复制 XXXX」（与改版前相同）
      if (r.found && r.code) await copy(r.code, { successMsg: t('account.code.copied', { code: r.code }) })
      else toast.info(t('alias.none'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="mh-alist__row">
      <div className="mh-alist__top">
        <span className="mh-alist__main">
          <CopyAddr email={alias.alias_email} />
          <span className="mh-alist__sub">
            {t('alias.lastCode')}:{' '}
            {alias.last_code ? (
              <>
                <span className="mh-mono">{alias.last_code}</span>
                {alias.last_code_at && <> · {fmtRelative(alias.last_code_at, locale, now)}</>}
              </>
            ) : (
              t('common.none')
            )}
          </span>
        </span>
        <ActBtn icon={KeyRound} label={t('alias.code')} showLabel tone="accent" busy={busy} onClick={onCode} />
      </div>
      {res && (
        <div className="mh-alist__res" role="status">
          {res.found && res.code ? (
            <>
              <CodeChip code={res.code} size="sm" />
              {res.message?.subject && <span className="mh-alist__sub">{res.message.subject}</span>}
            </>
          ) : (
            <span className="mh-alist__sub">{t('alias.none')}</span>
          )}
          {res.links?.length > 0 && (
            <span className="mh-linklist">
              {res.links.map((l, i) => (
                <a key={i} href={l} target="_blank" rel="noreferrer" title={l}>
                  <ExternalLink size={12} aria-hidden />
                  <span>{l}</span>
                </a>
              ))}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

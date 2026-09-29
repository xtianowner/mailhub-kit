import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  AlertTriangle,
  KeyRound,
  RotateCw,
  RefreshCw,
  Mail,
  MailWarning,
  ExternalLink,
  Tags,
  History,
  ChevronDown,
  Info,
  X,
  StickyNote,
  Pencil,
  Check,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, fmtRelative, bucketTone } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useCopy } from '../lib/useCopy.js'
import { Button, Badge, Card, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'

// Floor the poll interval at 5s so a tiny/blank settings value can't hammer the API.
const POLL_FLOOR_S = 5
function parsePollSeconds(raw) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return 15
  return Math.max(POLL_FLOOR_S, n)
}

const TEXT_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  subtle: 'text-subtle',
}

export default function AccountPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useLocale()
  const toast = useToast()
  const copy = useCopy()

  const [acc, setAcc] = useState(null)
  const [accState, setAccState] = useState('loading')
  const [msgs, setMsgs] = useState([])
  const [msgState, setMsgState] = useState('loading')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeRes, setCodeRes] = useState(null)

  // ── client-side mail filter chips (no requests) ──────────
  const [codeOnly, setCodeOnly] = useState(false)
  const [selTags, setSelTags] = useState(() => new Set())
  const [selSenders, setSelSenders] = useState(() => new Set())

  // ── auto-refresh (item 4) ────────────────────────────────
  const [autoOn, setAutoOn] = useState(true)
  const [pollSec, setPollSec] = useState(15)
  const seenCodesRef = useRef(null) // Set of codes already observed; null until first load
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

  // loadMsgs(opts.silent) — silent=true skips the loading spinner (used by polling)
  // and, after the first baseline load, toasts any newly-arrived verification code.
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
        // new-code detection
        const codes = list.map((m) => m.verification_code).filter(Boolean)
        if (seenCodesRef.current === null) {
          seenCodesRef.current = new Set(codes) // first load = baseline, no toast
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

  // reset new-code baseline + filter selections when switching accounts
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

  // fetch poll interval from settings once (floored at 5s)
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

  // auto-refresh timer — only while toggled on and account is alive
  const isDeadAcc = acc?.status === 'dead'
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!autoOn || isDeadAcc) return
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
      } else {
        // success → auto-copy to clipboard + toast "已复制 XXXX"
        if (res.code) await copy(res.code, { successMsg: t('account.code.copied', { code: res.code }) })
        else toast.success(t('account.code.found'))
      }
      loadMsgs()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setCodeBusy(false)
    }
  }

  // ── derived facets + filtered list (client-side only) ────
  // Tag facets: every distinct tag present in the loaded messages.
  const tagFacets = useMemo(() => {
    const seen = new Set()
    for (const m of msgs) for (const tg of m.tags || []) if (tg) seen.add(tg)
    return [...seen].sort()
  }, [msgs])

  // Sender facets keyed by domain (the discriminating part of from_address);
  // value = the registrable-ish label shown on the chip, count for ordering.
  const senderFacets = useMemo(() => {
    const counts = new Map()
    for (const m of msgs) {
      const dom = senderDomain(m.from_address)
      if (!dom) continue
      counts.set(dom, (counts.get(dom) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([dom]) => dom)
  }, [msgs])

  const filteredMsgs = useMemo(() => {
    return msgs.filter((m) => {
      if (codeOnly && !m.verification_code) return false
      if (selTags.size > 0) {
        const tags = m.tags || []
        if (!tags.some((tg) => selTags.has(tg))) return false // OR-match: any selected tag
      }
      if (selSenders.size > 0) {
        const dom = senderDomain(m.from_address)
        if (!dom || !selSenders.has(dom)) return false
      }
      return true
    })
  }, [msgs, codeOnly, selTags, selSenders])

  const filterActive = codeOnly || selTags.size > 0 || selSenders.size > 0
  const toggleSet = (setter) => (val) =>
    setter((prev) => {
      const next = new Set(prev)
      next.has(val) ? next.delete(val) : next.add(val)
      return next
    })
  const clearFilters = () => {
    setCodeOnly(false)
    setSelTags(new Set())
    setSelSenders(new Set())
  }

  if (accState === 'loading') return <StateBlock state="loading" />
  if (accState === 'notfound')
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <StateBlock state="empty" message={t('account.notFound')} />
        <Button variant="subtle" onClick={() => navigate('/hotmail')}>
          <ArrowLeft size={15} /> {t('account.back')}
        </Button>
      </div>
    )
  if (accState === 'error' || !acc) return <StateBlock state="error" onRetry={loadAcc} />

  const tone = bucketTone(acc.bucket)
  const isDead = acc.status === 'dead'

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/hotmail"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-colors hover:text-text"
      >
        <ArrowLeft size={15} /> {t('account.back')}
      </Link>

      {/* header */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="break-all font-heading text-xl font-semibold text-text">{acc.email}</h1>
          <Badge tone={isDead ? 'danger' : 'success'} dot>
            {t(`status.${acc.status}`)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>
            {t('account.rtExpires')}:{' '}
            <span className={`font-medium ${TEXT_TONE[tone] || 'text-text'}`}>
              {acc.rt_days_left === null || acc.rt_days_left === undefined
                ? t('table.never')
                : acc.rt_days_left < 0
                  ? t('table.expired')
                  : `${acc.rt_days_left} ${t('table.days')}`}
            </span>
            {acc.rt_expires_at && (
              <span className="ml-1.5 text-subtle">({fmtDate(acc.rt_expires_at)})</span>
            )}
          </span>
          <span>
            {t('account.lastRefresh')}:{' '}
            <span className="text-text">
              {acc.last_refresh_at ? fmtDateTime(acc.last_refresh_at) : t('common.none')}
            </span>
          </span>
          {acc.last_code && (
            <span className="inline-flex items-center gap-1.5">
              {t('table.lastCode')}:{' '}
              <CopyCode
                code={acc.last_code}
                size="sm"
                stale={acc.code_fresh === false}
                staleLabel={t('code.history')}
                staleTitle={
                  acc.code_fresh === false
                    ? t('code.history.hint', {
                        ago: acc.last_code_at ? fmtRelative(acc.last_code_at, locale) : '',
                      })
                    : undefined
                }
              />
            </span>
          )}
        </div>
        {isDead && (
          <div className="flex items-start gap-2 rounded border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{t('account.deadBanner')}</span>
          </div>
        )}
      </Card>

      {/* note + group editor */}
      <MetaSection acc={acc} onUpdated={(next) => setAcc(next)} t={t} />

      {/* code area */}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-heading text-base font-semibold text-text">{t('account.getCode')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <AutoRefreshToggle on={autoOn} onToggle={() => setAutoOn((v) => !v)} sec={pollSec} t={t} disabled={isDead} />
            <Button variant="primary" loading={codeBusy} onClick={onGetCode} disabled={isDead}>
              <KeyRound size={16} /> {t('account.getCode.btn')}
            </Button>
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-subtle">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{t('account.code.hint')}</span>
        </p>
        {codeRes && (
          <div className="flex flex-col gap-3">
            {codeRes.found && codeRes.code ? (
              <div className="flex flex-col items-center gap-3 py-3">
                <CopyCode code={codeRes.code} size="lg" />
                {codeRes.message?.subject && (
                  <span className="max-w-full truncate text-xs text-subtle">
                    {codeRes.message.subject}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted">
                {codeRes.dead ? t('account.deadBanner') : t('account.code.none')}
              </span>
            )}
            {codeRes.links?.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-subtle">{t('account.code.links')}</span>
                {codeRes.links.map((l, i) => (
                  <a
                    key={i}
                    href={l}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 truncate text-sm text-accent hover:underline"
                  >
                    <ExternalLink size={13} className="shrink-0" />
                    <span className="truncate">{l}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* code history (collapsible) */}
      <CodeHistorySection accountId={id} locale={locale} t={t} />

      {/* aliases */}
      <AliasSection accountId={id} locale={locale} t={t} />

      {/* mail list */}
      <Card className="flex flex-col p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
          <span className="font-heading text-base font-semibold text-text">{t('account.mails')}</span>
          <Button size="sm" variant="subtle" onClick={() => loadMsgs()} loading={msgState === 'loading'}>
            {msgState !== 'loading' && <RotateCw size={13} />}
            {t('account.mails.refresh')}
          </Button>
        </div>
        {msgState === 'ready' && msgs.length > 0 && (
          <MailFilterBar
            t={t}
            codeOnly={codeOnly}
            onToggleCodeOnly={() => setCodeOnly((v) => !v)}
            tagFacets={tagFacets}
            selTags={selTags}
            onToggleTag={toggleSet(setSelTags)}
            senderFacets={senderFacets}
            selSenders={selSenders}
            onToggleSender={toggleSet(setSelSenders)}
            filterActive={filterActive}
            onClear={clearFilters}
            shown={filteredMsgs.length}
            total={msgs.length}
          />
        )}
        {msgState === 'loading' && <StateBlock state="loading" />}
        {msgState === 'error' && <StateBlock state="error" onRetry={() => loadMsgs()} />}
        {msgState === 'ready' && msgs.length === 0 && (
          <StateBlock state="empty" message={t('account.mails.empty')} />
        )}
        {msgState === 'ready' && msgs.length > 0 && filteredMsgs.length === 0 && (
          <StateBlock state="empty" message={t('mails.filter.noMatch')} />
        )}
        {msgState === 'ready' && filteredMsgs.length > 0 && (
          <ul className="divide-y divide-border/50">
            {filteredMsgs.map((m) => (
              <li key={m.graph_message_id}>
                <Link
                  to={`/hotmail/accounts/${id}/messages/${m.graph_message_id}`}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2/40"
                >
                  <span className="mt-0.5 shrink-0">
                    {m.folder_name === 'junkemail' ? (
                      <Badge tone="warning">
                        <MailWarning size={12} /> {t('folder.junk')}
                      </Badge>
                    ) : (
                      <Badge tone="info">
                        <Mail size={12} /> {t('folder.inbox')}
                      </Badge>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-text">
                        {m.subject || '(no subject)'}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-subtle">
                        {m.received_at ? fmtRelative(m.received_at, locale) : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span className="truncate">
                        {m.from_name || m.from_address || t('common.none')}
                      </span>
                      {m.verification_code && (
                        <Badge tone="accent" className="shrink-0">
                          {m.verification_code}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* ── Note + group editor ───────────────────────────────────────
   View/edit card under the account header. View mode shows the current
   group badge + note (or an empty hint). Edit mode: a single-line group
   input (free text — new group names allowed) + a multi-line note textarea.
   Save → POST /api/accounts/{id}/meta, then lifts the returned account up so
   the rest of the page stays consistent. '' clears a field server-side. */
function MetaSection({ acc, onUpdated, t }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(acc.note || '')
  const [group, setGroup] = useState(acc.group_name || '')
  const [busy, setBusy] = useState(false)

  const startEdit = () => {
    setNote(acc.note || '')
    setGroup(acc.group_name || '')
    setEditing(true)
  }
  const cancel = () => setEditing(false)

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
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-heading text-base font-semibold text-text">
          <StickyNote size={16} className="text-muted" aria-hidden />
          {t('meta.title')}
        </span>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={startEdit}>
            <Pencil size={13} />
            {t('meta.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t('meta.group')}</span>
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t('meta.group.placeholder')}
              maxLength={64}
              className="h-10 w-full rounded border border-border bg-surface-2/60 px-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t('meta.note')}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('meta.note.placeholder')}
              rows={3}
              maxLength={500}
              className="w-full resize-y rounded border border-border bg-surface-2/60 px-3 py-2 text-sm leading-relaxed text-text placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="subtle" onClick={cancel} disabled={busy}>
              <X size={13} />
              {t('meta.cancel')}
            </Button>
            <Button size="sm" variant="primary" loading={busy} onClick={save}>
              {!busy && <Check size={14} />}
              {t('meta.save')}
            </Button>
          </div>
        </div>
      ) : hasMeta ? (
        <div className="flex flex-col gap-2.5">
          {acc.group_name && (
            <div>
              <Badge tone="accent">
                <Tags size={11} aria-hidden />
                {acc.group_name}
              </Badge>
            </div>
          )}
          {acc.note && (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
              {acc.note}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-subtle">{t('meta.empty')}</p>
      )}
    </Card>
  )
}

/* ── sender domain helper ──────────────────────────────────────
   from_address → its domain (the discriminating part used for sender chips).
   "noreply@tm.openai.com" → "tm.openai.com". Falls back to the raw value. */
function senderDomain(addr) {
  if (!addr || typeof addr !== 'string') return ''
  const i = addr.lastIndexOf('@')
  return (i >= 0 ? addr.slice(i + 1) : addr).trim().toLowerCase()
}

/* ── Mail filter chips (client-side, no requests) ──────────────
   Row of toggleable pills above the mail list:
   · "code only" switch  · per-tag chips  · per-sender-domain chips.
   Reuses the Badge pill geometry; selected = accent tint, idle = subtle. */
function FilterChip({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex max-w-[14rem] cursor-pointer select-none items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border/70 bg-surface-2/50 text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function MailFilterBar({
  t,
  codeOnly,
  onToggleCodeOnly,
  tagFacets,
  selTags,
  onToggleTag,
  senderFacets,
  selSenders,
  onToggleSender,
  filterActive,
  onClear,
  shown,
  total,
}) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-border/70 bg-surface-2/20 px-5 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={codeOnly} onClick={onToggleCodeOnly}>
          <KeyRound size={12} aria-hidden />
          {t('mails.filter.codeOnly')}
        </FilterChip>

        {tagFacets.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">
              {t('mails.filter.tags')}
            </span>
            {tagFacets.map((tg) => (
              <FilterChip key={tg} active={selTags.has(tg)} onClick={() => onToggleTag(tg)} title={tg}>
                {tg}
              </FilterChip>
            ))}
          </>
        )}

        {senderFacets.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">
              {t('mails.filter.senders')}
            </span>
            {senderFacets.map((dom) => (
              <FilterChip
                key={dom}
                active={selSenders.has(dom)}
                onClick={() => onToggleSender(dom)}
                title={dom}
              >
                {dom}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] tabular-nums text-subtle">
          {t('mails.filter.shown', { shown, total })}
        </span>
        {filterActive && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted transition-colors duration-fast hover:text-text"
          >
            <X size={12} aria-hidden />
            {t('mails.filter.clear')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Auto-refresh toggle ───────────────────────────────────────
   Pill switch that drives the mail-list polling. Shows the active interval. */
function AutoRefreshToggle({ on, onToggle, sec, t, disabled }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      title={`${t('account.autoRefresh')} · ${sec}s`}
      className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50 ${
        on && !disabled
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border/70 bg-surface-2/40 text-muted hover:text-text'
      }`}
    >
      <RefreshCw size={13} className={on && !disabled ? 'animate-spin' : ''} aria-hidden />
      {t('account.autoRefresh')}
      <span className="tabular-nums opacity-70">{on ? `${sec}s` : ''}</span>
    </button>
  )
}

/* ── Code history (collapsible) ────────────────────────────────
   Lists cached messages on this account that carried a verification code:
   GET /api/accounts/{id}/codes. Each row: copyable code + from + subject + time. */
function CodeHistorySection({ accountId, locale, t }) {
  const [open, setOpen] = useState(false)
  const [codes, setCodes] = useState([])
  const [state, setState] = useState('idle') // idle|loading|error|ready
  const loadedFor = useRef(null)

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
    <Card className="flex flex-col p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex cursor-pointer items-center justify-between gap-2 px-5 py-3 text-left transition-colors hover:bg-surface-2/30"
      >
        <span className="inline-flex items-center gap-2 font-heading text-base font-semibold text-text">
          <History size={16} className="text-muted" aria-hidden />
          {t('history.title')}
          {state === 'ready' && codes.length > 0 && <Badge tone="subtle">{codes.length}</Badge>}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform duration-fast ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-t border-border/70">
          {state === 'loading' && <StateBlock state="loading" />}
          {state === 'error' && <StateBlock state="error" message={t('history.error')} onRetry={load} />}
          {state === 'ready' && codes.length === 0 && (
            <StateBlock state="empty" message={t('history.empty')} />
          )}
          {state === 'ready' && codes.length > 0 && (
            <ul className="divide-y divide-border/50">
              {codes.map((m, i) => (
                <li
                  key={m.graph_message_id || i}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3"
                >
                  <CopyCode code={m.verification_code} size="sm" className="text-base" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-text" title={m.subject || ''}>
                      {m.subject || '(no subject)'}
                    </span>
                    <span className="truncate text-xs text-subtle">
                      {m.from_address || m.from_name || t('common.none')}
                    </span>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-subtle">
                    {m.received_at ? fmtRelative(m.received_at, locale) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

/* ── Aliases section ───────────────────────────────────────────
   Lists plus-aliases sharing this canonical account's token. Each alias
   gets its own recipient-scoped "get code" (POST /api/aliases/{id}/code),
   which coexists with the account-level (latest-any-recipient) code above. */
function AliasSection({ accountId, locale, t }) {
  const [aliases, setAliases] = useState([])
  const [state, setState] = useState('loading') // loading|error|ready

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
    <Card className="flex flex-col p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-5 py-3">
        <span className="inline-flex items-center gap-2 font-heading text-base font-semibold text-text">
          <Tags size={16} className="text-muted" aria-hidden />
          {t('alias.title')}
          {state === 'ready' && aliases.length > 0 && (
            <Badge tone="accent">{aliases.length}</Badge>
          )}
        </span>
        <span className="text-xs text-subtle">{t('alias.hint')}</span>
      </div>
      {state === 'loading' && <StateBlock state="loading" />}
      {state === 'error' && <StateBlock state="error" message={t('alias.error')} onRetry={load} />}
      {state === 'ready' && aliases.length === 0 && (
        <StateBlock state="empty" message={t('alias.empty')} />
      )}
      {state === 'ready' && aliases.length > 0 && (
        <ul className="divide-y divide-border/50">
          {aliases.map((a) => (
            <AliasRow key={a.id} alias={a} locale={locale} t={t} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function AliasRow({ alias, locale, t }) {
  const toast = useToast()
  const copy = useCopy()
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null) // {found,code,links,message}

  const onCode = async () => {
    setBusy(true)
    try {
      const r = await api.aliasCode(alias.id)
      setRes(r)
      // success → auto-copy to clipboard + toast "已复制 XXXX"
      if (r.found && r.code) {
        await copy(r.code, { successMsg: t('account.code.copied', { code: r.code }) })
      } else {
        toast.info(t('alias.none'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-all text-sm font-medium text-text">{alias.alias_email}</span>
          <span className="text-xs text-subtle">
            {alias.last_code ? (
              <>
                {t('alias.lastCode')}: <span className="font-mono text-muted">{alias.last_code}</span>
                {alias.last_code_at && (
                  <span className="ml-1.5">· {fmtRelative(alias.last_code_at, locale)}</span>
                )}
              </>
            ) : (
              <span>{t('alias.lastCode')}: {t('common.none')}</span>
            )}
          </span>
        </div>
        <Button size="sm" variant="solid" loading={busy} onClick={onCode}>
          {!busy && <KeyRound size={13} />}
          {t('alias.code')}
        </Button>
      </div>

      {res && (
        <div className="flex flex-col gap-2 rounded border border-border/60 bg-surface-2/50 px-3.5 py-3">
          {res.found && res.code ? (
            <div className="flex flex-wrap items-center gap-3">
              <CopyCode code={res.code} size="sm" className="text-lg" />
              {res.message?.subject && (
                <span className="min-w-0 flex-1 truncate text-xs text-subtle">
                  {res.message.subject}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted">{t('alias.none')}</span>
          )}
          {res.links?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {res.links.map((l, i) => (
                <a
                  key={i}
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 truncate text-sm text-accent hover:underline"
                >
                  <ExternalLink size={13} className="shrink-0" aria-hidden />
                  <span className="truncate">{l}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

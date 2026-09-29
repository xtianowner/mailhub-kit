import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ChevronRight, Cloud, ExternalLink, KeyRound, Mailbox, RadioTower, Search, X,
} from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { fmtDateTime } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Badge, Button, Card, CopyCode } from '../components/ui.jsx'
import { PageHeader, SourceBadge, SourceFilter } from '../components/hub.jsx'
import { MailBody } from '../components/MailBody.jsx'

const RECENT_KEY = 'hub_recent_codes'
const POLL_MS = 5000

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.slice(0, 8) : []
  } catch {
    return []
  }
}

function pushRecent(email) {
  try {
    const next = [email, ...loadRecent().filter((e) => e !== email)].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    return next
  } catch {
    return loadRecent()
  }
}

// 统一接码：这是整个 mail-hub 的核心动作。填任意地址 → 后端按域名后缀判定走
// CFMail 还是 Graph → 回最新验证码。用户不需要知道自己在跟哪条链路打交道。
export default function UnifiedCodePage() {
  const { t } = useLocale()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const [email, setEmail] = useState(params.get('email') || '')
  const [source, setSource] = useState('all')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [touched, setTouched] = useState(false)
  const [polling, setPolling] = useState(false)
  const [recent, setRecent] = useState(loadRecent)
  const timerRef = useRef(null)

  const invalid = touched && email.trim() !== '' && !email.includes('@')

  const fetchCode = useCallback(
    async (addr, src, { quiet = false } = {}) => {
      const target = (addr ?? '').trim().toLowerCase()
      if (!target.includes('@')) {
        setTouched(true)
        if (!quiet) toast.error(t('code.needEmail'))
        return null
      }
      if (!quiet) setBusy(true)
      try {
        const res = await hubApi.code(target, src)
        setResult(res)
        if (res.found && !quiet) toast.success(t('code.result.found'))
        setRecent(pushRecent(target))
        return res
      } catch (err) {
        setResult({ email: target, found: false, error: err?.userMessage || t('common.error') })
        return null
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [t, toast],
  )

  const onSubmit = (e) => {
    e.preventDefault()
    setTouched(true)
    setParams(email.trim() ? { email: email.trim() } : {}, { replace: true })
    fetchCode(email, source)
  }

  // 自动轮询：等验证码时不必手点。取到码就自动停 —— 拿到了还继续打上游是纯浪费。
  useEffect(() => {
    if (!polling) {
      clearInterval(timerRef.current)
      return undefined
    }
    timerRef.current = setInterval(async () => {
      const res = await fetchCode(email, source, { quiet: true })
      if (res?.found) setPolling(false)
    }, POLL_MS)
    return () => clearInterval(timerRef.current)
  }, [polling, email, source, fetchCode])

  // 离开页面时一定要停掉轮询定时器。
  useEffect(() => () => clearInterval(timerRef.current), [])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader title={t('code.title')} subtitle={t('code.subtitle')} />

      <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder={t('code.input.placeholder')}
                  aria-label={t('code.input.placeholder')}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  spellCheck={false}
                  className={`h-11 w-full rounded border bg-surface-2/60 pl-9 pr-3 font-mono text-sm text-text placeholder:font-body placeholder:text-subtle focus:outline-none focus:ring-1 ${
                    invalid
                      ? 'border-danger focus:border-danger focus:ring-danger/40'
                      : 'border-border focus:border-accent focus:ring-accent/40'
                  }`}
                />
              </div>
              {invalid && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-danger">
                  <AlertTriangle size={12} aria-hidden />
                  {t('code.needEmail')}
                </p>
              )}
            </div>
            <Button type="submit" variant="primary" size="md" loading={busy} className="h-11 sm:w-auto">
              <KeyRound size={15} />
              {t('code.submit')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-subtle">{t('code.routed')}</span>
              <SourceFilter value={source} onPick={setSource} />
            </div>
            <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted">
              <input
                type="checkbox"
                checked={polling}
                onChange={(e) => setPolling(e.target.checked)}
                disabled={!email.includes('@')}
                className="h-3.5 w-3.5 cursor-pointer accent-accent disabled:cursor-not-allowed"
              />
              {t('code.autoPoll')}
            </label>
          </div>
        </form>

        {polling && (
          <p
            className="inline-flex items-center gap-1.5 text-xs text-accent"
            role="status"
            aria-live="polite"
          >
            <RadioTower size={13} className="animate-pulse" aria-hidden />
            {t('code.polling')}
          </p>
        )}
      </Card>

      {result ? <CodeResult result={result} t={t} /> : <RoutingExplainer t={t} />}

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pr-1 text-xs font-medium text-subtle">{t('code.recent')}</span>
          {recent.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setEmail(e)
                setParams({ email: e }, { replace: true })
                fetchCode(e, source)
              }}
              className="inline-flex cursor-pointer items-center rounded-full border border-border/70 bg-surface-2/50 px-2.5 py-1 font-mono text-[11px] text-muted transition-colors duration-fast hover:border-accent/40 hover:text-accent"
            >
              {e}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem(RECENT_KEY)
              } catch {
                /* ignore */
              }
              setRecent([])
            }}
            aria-label={t('common.clear') !== 'common.clear' ? t('common.clear') : 'clear'}
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-subtle transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

/* ── 空态：把「自动判定」的规则摊开讲 ─────────────────────────
   没结果时页面本来是一大片空白。与其留白，不如把判定规则讲清楚——
   用户第一次用最想知道的就是「它凭什么知道该去哪找我的码」。 */
function RoutingExplainer({ t }) {
  const [suffixes, setSuffixes] = useState([])
  useEffect(() => {
    hubApi
      .domains()
      .then((d) => setSuffixes(d.domains || []))
      .catch(() => setSuffixes([]))
  }, [])

  const rules = [
    {
      icon: Cloud,
      tone: 'text-accent',
      text: t('code.how.domain', {
        suffixes: suffixes.length ? suffixes.map((s) => `@${s}`).join(' / ') : '域名白名单',
      }),
    },
    { icon: Mailbox, tone: 'text-info', text: t('code.how.hotmail') },
  ]

  return (
    <Card className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <h2 className="font-heading text-sm font-semibold text-text">{t('code.how.title')}</h2>
      <ul className="flex flex-col gap-2.5">
        {rules.map(({ icon: Icon, tone, text }, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-muted">
            <Icon size={15} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden />
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border/50 pt-3 text-xs text-subtle">{t('code.how.hint')}</p>
    </Card>
  )
}

/* ── 结果卡 ──────────────────────────────────────────────────
   三种态各有明确画面：取到码（大号可点复制）/ 信箱在但没码 / 出错（说清怎么修）。 */
function CodeResult({ result, t }) {
  if (result.error) {
    return (
      <Card className="flex items-start gap-3 border-warning/30 bg-warning/5 px-4 py-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="font-mono text-sm text-text">{result.email}</p>
          <p className="mt-1 text-sm text-muted">{result.error}</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-4 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={result.source} />
        <span className="min-w-0 truncate font-mono text-sm text-muted">{result.email}</span>
      </div>

      {result.found ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <CopyCode code={result.code} size="lg" />
          <span className="text-xs text-subtle">{t('code.clickToCopy')}</span>
        </div>
      ) : (
        <p className="py-2 text-center text-sm text-subtle">{t('code.result.none')}</p>
      )}

      {(result.subject || result.received_at) && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-border/50 pt-3 text-xs sm:grid-cols-2">
          {result.subject && (
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-subtle">{t('code.subjectLabel')}</dt>
              <dd className="min-w-0 truncate text-muted" title={result.subject}>
                {result.subject}
              </dd>
            </div>
          )}
          {result.received_at && (
            <div className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-subtle">{t('code.timeLabel')}</dt>
              <dd className="tabular-nums text-muted">{fmtDateTime(result.received_at)}</dd>
            </div>
          )}
        </dl>
      )}

      {result.links?.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border/50 pt-3">
          <span className="text-xs text-subtle">{t('code.linksLabel')}</span>
          {result.links.slice(0, 5).map((l) => (
            <a
              key={l}
              href={l}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate font-mono text-xs text-accent transition-colors duration-fast hover:text-accent-hover"
              title={l}
            >
              {l}
            </a>
          ))}
        </div>
      )}

      {/* 最新那封信的正文。没提到码时**默认展开** —— 用户至少能自己看内容把码抠出来；
          提到码了就收起来，别挡住最重要的那串数字，想看再点。 */}
      {result.message && (
        <details
          open={!result.found}
          className="group border-t border-border/50 pt-3 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted transition-colors duration-fast hover:text-text">
            <ChevronRight
              size={13}
              className="shrink-0 transition-transform duration-fast group-open:rotate-90"
              aria-hidden
            />
            {t('md.body')}
            {result.message.subject && (
              <span className="min-w-0 truncate font-normal text-subtle">
                · {result.message.subject}
              </span>
            )}
            <Link
              to={`/message/${result.message.source}/${encodeURIComponent(
                result.message.message_id,
              )}${
                result.message.source === 'hotmail' && result.message.account_id
                  ? `?account_id=${result.message.account_id}`
                  : ''
              }`}
              onClick={(e) => e.stopPropagation()}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:text-accent-hover"
            >
              <ExternalLink size={11} aria-hidden />
              {t('md.openRaw')}
            </Link>
          </summary>
          <div className="pt-3">
            <MailBody
              messageKey={result.message.message_id}
              html={result.message.html_body}
              text={result.message.text_body || result.message.preview}
            />
          </div>
        </details>
      )}
    </Card>
  )
}

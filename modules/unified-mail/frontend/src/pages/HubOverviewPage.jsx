import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Cloud, Inbox, KeyRound, Mailbox, ShieldCheck } from 'lucide-react'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { fmtRelative } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Badge, Button, Card, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'
import { PageHeader, SourceBadge, UpstreamBar, useUpstreams } from '../components/hub.jsx'

// 统一总览：进门第一屏。回答三个问题——两条链路活着吗？我手上有多少邮箱？最近来了什么信？
export default function HubOverviewPage() {
  const { t, locale } = useLocale()
  const navigate = useNavigate()
  const { upstreams, state: upState, allOk, workerDiscovery, reload } = useUpstreams()

  const [summary, setSummary] = useState(null)
  const [recent, setRecent] = useState(null)
  const [listState, setListState] = useState('loading')

  const load = useCallback(async () => {
    // 没填密钥就别发请求了 —— 发出去必然失败，然后给用户看一个红色「请求失败」，
    // 而真实原因只是「你还没输入 token」。空态要说人话。
    setListState('loading')
    try {
      const [s, inbox] = await Promise.all([
        hubApi.summary(),
        hubApi.inbox({ limit: 8 }),
      ])
      setSummary(s)
      setRecent(inbox.rows || [])
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(IS_CLOUD ? 'hub.title.cloud' : 'hub.title')}
        subtitle={t(IS_CLOUD ? 'hub.subtitle.cloud' : 'hub.subtitle')}
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => navigate('/inbox')}>
              <Inbox size={15} />
              {t('hub.quick.inbox')}
            </Button>
            <Button variant="primary" size="md" onClick={() => navigate('/code')}>
              <KeyRound size={15} />
              {t('hub.quick.code')}
            </Button>
          </>
        }
      />

      <UpstreamBar
        upstreams={upstreams}
        state={upState}
        onRetry={reload}
        workerDiscovery={workerDiscovery}
      />

      {/* 没填密钥时不要再叠一层「部分上游不可用」—— 上面的引导条已经说清楚了 */}
      {upState === 'ready' && !allOk && (
        <Card className="flex items-start gap-2.5 border-warning/30 bg-warning/5 px-4 py-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-muted">{t('hub.degraded')}</p>
        </Card>
      )}

      <SummaryCards summary={summary} t={t} />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <h2 className="font-heading text-sm font-semibold text-text">{t('hub.recent.title')}</h2>
          <Link
            to="/inbox"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors duration-fast hover:text-accent-hover"
          >
            {t('hub.recent.more')}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>

        {listState !== 'ready' ? (
          <StateBlock state={listState} onRetry={load} />
        ) : recent.length === 0 ? (
          <StateBlock state="empty" message={t(IS_CLOUD ? 'inbox.empty.cloud' : 'inbox.empty')} />
        ) : (
          <ul className="divide-y divide-border/50">
            {recent.map((m) => (
              <li key={`${m.source}:${m.mailbox}:${m.message_id}`}>
                <Link
                  to={`/message/${m.source}/${encodeURIComponent(m.message_id)}${
                    m.source === 'hotmail' && m.account_id ? `?account_id=${m.account_id}` : ''
                  }`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-fast hover:bg-surface-2/40"
                >
                <SourceBadge source={m.source} />
                <span className="min-w-0 flex-1 truncate text-sm text-text" title={m.subject || ''}>
                  {m.subject || <span className="text-subtle">（无主题）</span>}
                </span>
                <span
                  className="hidden max-w-[220px] truncate font-mono text-xs text-muted sm:inline"
                  title={m.mailbox}
                >
                  {m.mailbox}
                </span>
                {m.code && <CopyCode code={m.code} size="sm" />}
                  <span className="shrink-0 tabular-nums text-xs text-subtle">
                    {fmtRelative(m.received_at, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* ── 汇总卡片 ────────────────────────────────────────────────
   四张：Hotmail 账号（带健康分解）/ 域名信箱 / 最近邮件 / 其中带码。
   前两张点进去是各自的管理页，后两张点进去是统一收件箱。 */
function SummaryCards({ summary, t }) {
  const hot = summary?.hotmail
  const dom = summary?.domain
  const cards = [
    {
      key: 'hotmail',
      to: '/hotmail',
      icon: Mailbox,
      label: t('hub.card.hotmail'),
      value: hot?.accounts ?? '—',
      available: hot?.available,
      sub:
        hot?.available && hot?.accounts
          ? [
              { tone: 'success', text: `${hot.ok} ${t('bucket.ok')}` },
              { tone: 'warning', text: `${hot.expiring} ${t('bucket.expiring')}` },
              { tone: 'danger', text: `${hot.expired} ${t('bucket.expired')}` },
            ]
          : null,
    },
    {
      key: 'domain',
      to: '/domain',
      icon: Cloud,
      label: t('hub.card.domain'),
      value: dom?.mailboxes ?? '—',
      available: dom?.available,
      sub: dom?.suffixes?.length
        ? [{ tone: 'subtle', text: dom.suffixes.join(' · ') }]
        : null,
    },
    {
      key: 'recent',
      to: '/inbox',
      icon: Inbox,
      label: t('hub.card.recent'),
      value: summary?.recent_count ?? '—',
      available: true,
      sub: null,
    },
    {
      key: 'codes',
      to: '/inbox?only_codes=1',
      icon: KeyRound,
      label: t('hub.card.codes'),
      value: summary?.recent_with_code ?? '—',
      available: true,
      sub: null,
    },
  ]

  // 云端版根本不管 Hotmail，摆一张恒为 0 的卡片只会让人以为出问题了
  const visible = IS_CLOUD ? cards.filter((c) => c.key !== 'hotmail') : cards

  return (
    <div className={`grid grid-cols-2 gap-2.5 ${IS_CLOUD ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
      {visible.map(({ key, to, icon: Icon, label, value, available, sub }) => (
        <Link
          key={key}
          to={to}
          className="group flex flex-col gap-1.5 rounded-lg border border-border/70 bg-surface/60 px-3.5 py-3 backdrop-blur-sm transition-all duration-fast hover:border-accent/50"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Icon size={13} aria-hidden />
            {label}
            {available === false && (
              <Badge tone="warning" className="ml-auto px-1.5 py-0 text-[10px]">
                {t('up.down')}
              </Badge>
            )}
          </span>
          <span className="font-heading text-2xl font-semibold tabular-nums text-text">
            {value}
          </span>
          {sub && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
              {sub.map((s, i) => (
                <span key={i} className={TONE_TEXT[s.tone]}>
                  {s.text}
                </span>
              ))}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}

// 字面量映射 —— Tailwind JIT 只扫字面串，`text-${x}` 会被丢掉。
const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  subtle: 'text-subtle',
}

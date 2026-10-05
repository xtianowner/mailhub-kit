import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Cloud, Globe, Inbox, KeyRound, Mailbox } from 'lucide-react'
import { IS_CLOUD } from '../lib/hubApi.js'
import { useNow } from '../lib/motion.js'
import { announce } from '../lib/announce.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { PageHeader } from '../components/hub.jsx'
import { DetailDrawer } from '../components/DetailDrawer.jsx'
import { HubFlow } from '../components/overview/HubFlow.jsx'
import { InfoPanel } from '../components/overview/InfoPanel.jsx'
import { SearchCommand } from '../components/overview/SearchCommand.jsx'
import { FilterBar } from '../components/overview/FilterBar.jsx'
import { LIMITS, MailTimeline } from '../components/overview/MailTimeline.jsx'
import { MailDetail, messageHref } from '../components/overview/MailDetail.jsx'
import { StatCard, StatusLight, fmtNum } from '../components/overview/StatCard.jsx'
import { buildNodes, mergeGroups, nodeIdFor, useOverviewInfo, useTimeline } from '../components/overview/useOverview.js'

const DEFAULT_LIMIT = 20
const DRAWER_KEYS = ['m_src', 'm_id', 'm_acct']

// 在查询串上打补丁：空值 = 删掉这个参数
function patchParams(params, patch) {
  const next = new URLSearchParams(params)
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k)
    else next.set(k, v)
  }
  return next
}

/* 统一总览（候选 A · 汇流枢纽）。从上到下：
   邮箱信息（汇流动画 + 2×2 统计卡，可折叠）→ 命令面板式搜索 + 筛选（来源 / 分组 / 只看带验证码）
   → 最近邮件（两个来源混在一条时间线里，10 / 20 / 50 / 100 条，不翻页）→ 点一行在右侧抽屉看详情。
   筛选与打开的邮件全部落 URL（q / source / group / only_codes / limit / m_*）：刷新、分享链接后视图不丢，浏览器后退 = 关抽屉。 */
export default function HubOverviewPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const now = useNow(30_000)

  const q = (params.get('q') || '').trim()
  const group = (params.get('group') || '').trim()
  const onlyCodes = params.get('only_codes') === '1'
  const rawSource = params.get('source')
  const source = !IS_CLOUD && (rawSource === 'hotmail' || rawSource === 'domain') ? rawSource : 'all'
  const rawLimit = parseInt(params.get('limit') || '', 10)
  const limit = LIMITS.includes(rawLimit) ? rawLimit : DEFAULT_LIMIT

  const info = useOverviewInfo()
  const timeline = useTimeline({ limit, q, source, group, onlyCodes })

  const setParam = useCallback(
    (patch) => setParams((prev) => patchParams(prev, patch), { replace: true }),
    [setParams],
  )
  const hrefWith = (patch) => {
    const s = patchParams(params, { ...patch, m_src: '', m_id: '', m_acct: '' }).toString()
    return s ? `/?${s}` : '/'
  }

  /* ── 邮箱信息 ── */
  const data = info.data
  const nodes = useMemo(() => buildNodes(data, t), [data, t])
  const groups = useMemo(() => mergeGroups(data?.hotmailGroups, data?.domainBoxes, group), [data, group])
  const upstreams = data?.health?.upstreams || []
  const upOf = (src) => upstreams.find((u) => u.source === src)
  const statusOf = (u) =>
    !u ? '—' : u.ok ? t('up.ok') : u.detail?.includes('未配置') || u.detail?.includes('密钥') ? t('up.unconfigured') : t('up.down')
  const lights = (IS_CLOUD ? ['domain'] : ['hotmail', 'domain']).map((src) => {
    const u = upOf(src)
    return {
      key: src,
      label: t(src === 'hotmail' ? 'src.hotmail' : 'src.domain'),
      long: t(src === 'hotmail' ? 'ov.link.hotmail' : 'ov.link.domain'),
      status: info.state === 'loading' ? '…' : statusOf(u),
      tone: !u || u.ok ? 'ok' : 'warn',
      title: [t(src === 'hotmail' ? 'up.hotmail.hint' : 'up.domain.hint'), u?.detail].filter(Boolean).join('\n'),
    }
  })
  const degraded = info.state === 'ready' && upstreams.length > 0 && upstreams.some((u) => !u.ok)
  const legacyWorker = !IS_CLOUD && info.state === 'ready' && data?.health?.worker_discovery === false
  const hot = data?.summary?.hotmail
  const dom = data?.summary?.domain
  const domains = data?.domains || []
  const mailboxCount = Array.isArray(data?.domainBoxes) ? data.domainBoxes.length : dom?.mailboxes
  const recent = data?.summary?.recent_count
  const withCode = data?.summary?.recent_with_code
  const pct = recent ? Math.round(((withCode || 0) / recent) * 100) : 0
  const light = (src) => {
    const u = upOf(src)
    return u ? { tone: u.ok ? 'ok' : 'warn', label: `${t(src === 'hotmail' ? 'src.hotmail' : 'src.domain')} · ${statusOf(u)}` } : null
  }

  const cards = [
    IS_CLOUD
      ? {
          key: 'domains',
          icon: Globe,
          label: t('ov.card.domains'),
          value: domains.length,
          sub: domains.length ? domains.join(' · ') : null,
          to: '/domain',
        }
      : {
          key: 'hotmail',
          icon: Mailbox,
          label: t('hub.card.hotmail'),
          value: hot?.available ? hot.accounts : NaN,
          light: light('hotmail'),
          sub:
            hot?.available && hot.accounts ? (
              <span className="mh-health">
                <span className="ok">{t('ov.health.ok', { n: fmtNum(hot.ok) })}</span>
                <span className="warn">{t('ov.health.expiring', { n: fmtNum(hot.expiring) })}</span>
                <span className="bad">{t('ov.health.expired', { n: fmtNum(hot.expired) })}</span>
              </span>
            ) : hot && !hot.available ? (
              t('up.down')
            ) : null,
          to: '/hotmail',
        },
    {
      key: 'domain',
      icon: Cloud,
      label: t('hub.card.domain'),
      value: Number.isFinite(mailboxCount) ? mailboxCount : NaN,
      light: light('domain'),
      sub: domains.length ? t('ov.card.domainsSub', { n: domains.length }) : null,
      to: '/domain',
    },
    {
      key: 'recent',
      icon: Inbox,
      label: t('hub.card.recent'),
      value: Number.isFinite(recent) ? recent : NaN,
      sub: t('ov.card.recentSub'),
      to: hrefWith({ only_codes: '' }),
    },
    {
      key: 'codes',
      icon: KeyRound,
      label: t('hub.card.codes'),
      value: Number.isFinite(withCode) ? withCode : NaN,
      sub: Number.isFinite(withCode) && recent ? t('ov.card.codesSub', { pct }) : null,
      to: hrefWith({ only_codes: '1' }),
    },
  ]

  const summaryLine = (
    <p className="mh-summary">
      {!IS_CLOUD && (
        <span className="mh-summary__item">
          <span className="mh-dot mh-dot--hotmail" aria-hidden />
          {t('src.hotmail')} <b>{hot?.available ? fmtNum(hot.accounts) : '—'}</b>
          {hot?.expiring > 0 && <span className="mh-summary__warn">{t('ov.health.expiring', { n: fmtNum(hot.expiring) })}</span>}
        </span>
      )}
      <span className="mh-summary__item">
        <span className="mh-dot mh-dot--domain" aria-hidden />
        {t('src.domain')} <b>{fmtNum(mailboxCount)}</b>
      </span>
      <span className="mh-summary__item">
        {t('hub.card.recent')} <b>{fmtNum(recent)}</b>
      </span>
      <span className="mh-summary__item">
        {t('hub.card.codes')} <b>{fmtNum(withCode)}</b>
      </span>
      <span className={`mh-summary__item ${degraded ? 'is-warn' : 'is-ok'}`}>
        <StatusLight tone={degraded ? 'warn' : 'ok'} label={t(degraded ? 'hub.degraded' : 'ov.link.allOk')} />
        {t(degraded ? 'ov.link.someDown' : 'ov.link.allOk')}
      </span>
    </p>
  )

  const notice =
    degraded || legacyWorker ? (
      <p className="mh-info__notice" role="status">
        <AlertTriangle size={14} aria-hidden />
        <span>{legacyWorker ? t('up.worker.legacy.hint') : t('hub.degraded')}</span>
      </p>
    ) : null

  /* ── 新邮件到达：汇流动画发一颗大光点 + 读屏播报 ── */
  const arrival = timeline.arrival
  const flowArrival = useMemo(
    () => (arrival ? { id: arrival.id, nodeId: nodeIdFor(arrival.row, nodes) } : null),
    [arrival, nodes],
  )
  const announced = useRef(null)
  useEffect(() => {
    if (!arrival || announced.current === arrival.id) return
    announced.current = arrival.id
    announce(
      arrival.count > 1
        ? t('ov.arrival.many', { n: arrival.count })
        : t('ov.arrival.one', { subject: arrival.row.subject || t('common.noSubject') }),
    )
  }, [arrival, t])

  /* ── 筛选 ── */
  const filtersActive = Boolean(q || group || onlyCodes || source !== 'all')
  const onSource = useCallback(
    (s) => {
      const keep = !group || s === 'all' || groups.some((g) => g.name === group && g.sources.has(s))
      setParam({ source: s === 'all' ? '' : s, ...(keep ? {} : { group: '' }) })
    },
    [group, groups, setParam],
  )
  const onReset = useCallback(() => setParam({ q: '', source: '', group: '', only_codes: '' }), [setParam])

  /* ── 抽屉（URL 即状态：打开推一条历史，后退即关闭）── */
  const mSrc = params.get('m_src')
  const mId = params.get('m_id')
  const mAcct = params.get('m_acct')
  const target = useMemo(
    () => (mSrc && mId && (mSrc === 'hotmail' || mSrc === 'domain') ? { source: mSrc, id: mId, account_id: mAcct || '' } : null),
    [mSrc, mId, mAcct],
  )
  const preview = useMemo(
    () => (target ? timeline.rows.find((r) => r.source === target.source && String(r.message_id) === target.id) : null),
    [target, timeline.rows],
  )
  const pushed = useRef(false)
  useEffect(() => {
    if (!target) pushed.current = false
  }, [target])
  // setParams 每次 URL 变化都会换一个新函数；行组件拿到的 onOpen 必须恒定，否则每次开关抽屉整张列表都要重渲染
  const setParamsRef = useRef(setParams)
  setParamsRef.current = setParams
  const openRow = useCallback((m) => {
    pushed.current = true
    setParamsRef.current(
      (prev) =>
        patchParams(prev, {
          m_src: m.source,
          m_id: String(m.message_id),
          m_acct: m.source === 'hotmail' && m.account_id ? String(m.account_id) : '',
        }),
      { replace: false },
    )
  }, [])
  const closeDrawer = useCallback(() => {
    if (pushed.current) {
      pushed.current = false
      navigate(-1)
    } else {
      setParam(Object.fromEntries(DRAWER_KEYS.map((k) => [k, ''])))
    }
  }, [navigate, setParam])

  return (
    <div className="mh-page">
      <PageHeader
        title={t(IS_CLOUD ? 'hub.title.cloud' : 'hub.title')}
        subtitle={t(IS_CLOUD ? 'hub.subtitle.cloud' : 'hub.subtitle')}
      />

      <InfoPanel
        lights={lights}
        summary={summaryLine}
        notice={notice}
        onRefresh={() => {
          info.reload()
          timeline.reload()
        }}
        refreshing={info.state === 'refreshing'}
      >
        <div className="mh-a">
          <div className="mh-a__flow">
            {info.state === 'loading' && !data ? (
              <div className="mh-a__flow-wait" aria-hidden />
            ) : (
              <HubFlow
                nodes={nodes}
                arrival={flowArrival}
                formatValue={fmtNum}
                label={t('ov.flow.label', {
                  list: nodes.map((n) => (n.value != null ? `${n.title} ${fmtNum(n.value)}` : n.title)).join(t('ov.flow.sep')),
                })}
              />
            )}
          </div>
          <div className="mh-stats">
            {cards.map(({ key, ...c }) => (
              <StatCard key={key} {...c} />
            ))}
          </div>
        </div>
      </InfoPanel>

      <div className="mh-searchrow">
        <SearchCommand
          value={q}
          onSearch={(v) => setParam({ q: v })}
          resultHint={timeline.state === 'ready' ? t('ov.search.hint', { n: timeline.rows.length }) : undefined}
        />
        <FilterBar
          showSource={!IS_CLOUD}
          source={source}
          onSource={onSource}
          groups={groups}
          group={group}
          onGroup={(g) => setParam({ group: g })}
          onlyCodes={onlyCodes}
          onOnlyCodes={(v) => setParam({ only_codes: v ? '1' : '' })}
          active={filtersActive}
          onReset={onReset}
        />
      </div>

      <MailTimeline
        rows={timeline.rows}
        state={timeline.state}
        limit={limit}
        onLimit={(n) => setParam({ limit: n === DEFAULT_LIMIT ? '' : String(n) })}
        query={q}
        filtersActive={filtersActive}
        onReset={onReset}
        onOpen={openRow}
        onRetry={timeline.reload}
        showSource={!IS_CLOUD}
        now={now}
        emptyMessage={t(IS_CLOUD ? 'inbox.empty.cloud' : 'inbox.empty')}
      />

      <DetailDrawer
        open={Boolean(target)}
        onClose={closeDrawer}
        title={t('drawer.mailTitle')}
        resizeKey="mail"
        allowFullscreen
        externalHref={target ? messageHref(target) : undefined}
      >
        {target && <MailDetail key={`${target.source}:${target.id}`} target={target} preview={preview} />}
      </DetailDrawer>
    </div>
  )
}

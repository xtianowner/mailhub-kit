import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Info, RefreshCw, Search } from 'lucide-react'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { fmtDateTime, fmtRelative } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Button, Card, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'
import { PageHeader, SourceBadge, SourceFilter, UpstreamBar, useUpstreams } from '../components/hub.jsx'

// 统一收件箱：两个来源归并成一条按时间倒序的信息流。
// 筛选状态全部落 URL —— 刷新/分享链接后视图不丢（与账号总览一致的约定）。
export default function UnifiedInboxPage() {
  const { t, locale } = useLocale()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { upstreams, state: upState, workerDiscovery, reload: reloadUp } = useUpstreams()

  const q = params.get('q') || ''
  const source = ['all', 'hotmail', 'domain'].includes(params.get('source'))
    ? params.get('source')
    : 'all'
  const onlyCodes = params.get('only_codes') === '1'
  const [searchInput, setSearchInput] = useState(q)

  const [rows, setRows] = useState([])
  const [listState, setListState] = useState('loading')

  const load = useCallback(async () => {
    setListState('loading')
    try {
      const res = await hubApi.inbox({
        limit: 100,
        q: q || undefined,
        source,
        only_codes: onlyCodes ? 'true' : undefined,
      })
      setRows(res.rows || [])
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [q, source, onlyCodes])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    setSearchInput(q)
  }, [q])

  const setParam = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === undefined || v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const onSubmitSearch = (e) => {
    e.preventDefault()
    setParam({ q: searchInput.trim() })
  }

  const openRow = (m) => {
    // 两个来源都进统一详情页 —— 没验证码的信同样要能读全文。
    const qsAcct = m.source === 'hotmail' && m.account_id ? `?account_id=${m.account_id}` : ''
    navigate(`/message/${m.source}/${encodeURIComponent(m.message_id)}${qsAcct}`)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('inbox.title')}
        subtitle={t(IS_CLOUD ? 'inbox.subtitle.cloud' : 'inbox.subtitle')}
        actions={
          <Button variant="ghost" size="md" onClick={load} loading={listState === 'loading'}>
            <RefreshCw size={15} />
            {t('inbox.refresh')}
          </Button>
        }
      />

      <UpstreamBar
        upstreams={upstreams}
        state={upState}
        onRetry={reloadUp}
        workerDiscovery={workerDiscovery}
      />

      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <form onSubmit={onSubmitSearch} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('inbox.search.placeholder')}
              aria-label={t('inbox.search.placeholder')}
              className="h-10 w-full rounded border border-border bg-surface-2/60 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <Button type="submit" variant="solid" size="md">
            {t('overview.search')}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 云端版只有域名邮箱一个来源，来源筛选没有意义，整组不出现 */}
          {!IS_CLOUD && (
            <SourceFilter value={source} onPick={(s) => setParam({ source: s === 'all' ? '' : s })} />
          )}
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted">
            <input
              type="checkbox"
              checked={onlyCodes}
              onChange={(e) => setParam({ only_codes: e.target.checked ? '1' : '' })}
              className="h-3.5 w-3.5 cursor-pointer accent-accent"
            />
            {t('inbox.onlyCodes')}
          </label>
        </div>
      </Card>

      <p className="inline-flex items-start gap-1.5 text-xs text-subtle">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        {!IS_CLOUD && (
          <>
            {t('inbox.hotmailCached')}
            <span className="text-subtle/70">·</span>
          </>
        )}
        {t('inbox.openHint')}
      </p>

      <Card className="overflow-hidden">
        {listState !== 'ready' ? (
          <StateBlock state={listState} onRetry={load} />
        ) : rows.length === 0 ? (
          <StateBlock state="empty" message={t(IS_CLOUD ? 'inbox.empty.cloud' : 'inbox.empty')} />
        ) : (
          <>
            {/* 窄屏（< lg）一封信一张卡。表格 5 个定宽列合计 696px，1024 以下主题列会被挤到
                几乎 0 宽、验证码列被推出屏；卡片里主题完整换行，验证码放大可点复制。
                整卡可点：主题按钮的 ::after 铺满整张卡（stretched link），验证码按钮在
                DOM 里排在后面、叠在它上面，所以点码只复制、不跳转。 */}
            <ul className="divide-y divide-border/40 lg:hidden">
              {rows.map((m) => (
                <li
                  key={`${m.source}:${m.mailbox}:${m.message_id}`}
                  className="relative flex flex-col gap-1.5 px-4 py-3 transition-colors duration-fast hover:bg-surface-2/50"
                >
                  <div className="flex items-start gap-2 text-xs">
                    {/* 本地版两个来源混排，窄屏也要一眼分出来；云端版只有一个来源，省掉 */}
                    {!IS_CLOUD && <SourceBadge source={m.source} />}
                    <span className="min-w-0 flex-1 break-all font-mono text-muted">{m.mailbox}</span>
                    <span
                      className="shrink-0 tabular-nums text-subtle"
                      title={fmtDateTime(m.received_at)}
                    >
                      {fmtRelative(m.received_at, locale)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openRow(m)}
                    className="w-full cursor-pointer break-words text-left text-sm text-text after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
                  >
                    {m.subject || <span className="text-subtle">（无主题）</span>}
                  </button>
                  <div className="flex items-center gap-3">
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-muted"
                      title={m.from_address || ''}
                    >
                      {m.from_name || m.from_address || '—'}
                    </span>
                    {m.code && (
                      <CopyCode
                        code={m.code}
                        size="sm"
                        className="relative border border-accent/30 bg-accent/5 px-2 py-1 text-base font-semibold before:absolute before:-inset-1.5"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs font-medium text-subtle">
                    <th className="w-[92px] px-4 py-2.5 align-middle">{t('inbox.col.received')}</th>
                    <th className="w-[104px] px-2 py-2.5 align-middle">{t('inbox.col.source')}</th>
                    <th className="w-[200px] px-2 py-2.5 align-middle">{t('inbox.col.mailbox')}</th>
                    <th className="w-[168px] px-2 py-2.5 align-middle">{t('inbox.col.from')}</th>
                    <th className="px-2 py-2.5 align-middle">{t('inbox.col.subject')}</th>
                    <th className="w-[132px] px-4 py-2.5 align-middle">{t('inbox.col.code')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((m) => (
                    <tr
                      key={`${m.source}:${m.mailbox}:${m.message_id}`}
                      onClick={() => openRow(m)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openRow(m)
                        }
                      }}
                      className="cursor-pointer align-middle transition-colors duration-fast hover:bg-surface-2/50 focus:bg-surface-2/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
                    >
                      <td
                        className="whitespace-nowrap px-4 py-2.5 align-middle tabular-nums text-xs text-subtle"
                        title={fmtDateTime(m.received_at)}
                      >
                        {fmtRelative(m.received_at, locale)}
                      </td>
                      <td className="px-2 py-2.5 align-middle">
                        <SourceBadge source={m.source} />
                      </td>
                      <td
                        className="truncate px-2 py-2.5 align-middle font-mono text-xs text-muted"
                        title={m.mailbox}
                      >
                        {m.mailbox}
                      </td>
                      <td
                        className="truncate px-2 py-2.5 align-middle text-xs text-muted"
                        title={m.from_address || ''}
                      >
                        {m.from_name || m.from_address || '—'}
                      </td>
                      <td className="truncate px-2 py-2.5 align-middle text-text" title={m.subject || ''}>
                        {m.subject || <span className="text-subtle">（无主题）</span>}
                      </td>
                      <td className="px-4 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        {m.code ? <CopyCode code={m.code} size="sm" /> : <span className="text-subtle">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

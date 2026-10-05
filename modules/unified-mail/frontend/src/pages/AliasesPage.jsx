import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowUpRight, KeyRound, RotateCcw } from 'lucide-react'
import { api } from '../lib/api.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { PageHeader } from '../components/hub.jsx'
import { Pager, PAGE_SIZE_OPTIONS } from '../components/Pager.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { SearchCommand } from '../components/overview/SearchCommand.jsx'
import { ActBtn, CodeCell, CopyAddr, StatusPill, rowSpotlight } from '../components/work.jsx'

/* 别名管理（/hotmail/aliases）：集中查看与按别名接码。功能与改版前相同 ——
   后端分页（每页 50 / 100 / 200，翻页条在表格上方）、按别名地址搜索、逐行定向接码、进入所属账号。
   只换呈现：与 Hotmail 账号表同一套行样式（等宽地址点击复制、状态胶囊、验证码胶囊、悬停聚光）。 */
export default function AliasesPage() {
  const { t } = useLocale()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') || ''
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
  const rawSize = parseInt(params.get('size') || '50', 10)
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawSize) ? rawSize : 50

  const [data, setData] = useState(null)
  const [listState, setListState] = useState('loading')
  const [rowBusy, setRowBusy] = useState({})
  const [rowCode, setRowCode] = useState({})

  const load = useCallback(async () => {
    setListState((s) => (s === 'ready' ? 'refreshing' : 'loading'))
    try {
      setData(await api.aliases({ q: q || undefined, page, page_size: pageSize }))
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [q, page, pageSize])

  useEffect(() => {
    load()
  }, [load])

  const setParam = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  const onPage = (p) => {
    setParam({ page: p > 1 ? p : undefined })
    scrollTop()
  }
  const onPageSize = (n) => {
    setParam({ size: n === 50 ? undefined : n, page: undefined })
    scrollTop()
  }

  const onCode = useCallback(
    async (alias) => {
      setRowBusy((m) => ({ ...m, [alias.id]: true }))
      try {
        const res = await api.aliasCode(alias.id)
        const subject = res.message?.subject ?? null
        setRowCode((m) => ({ ...m, [alias.id]: { ...res, subject } }))
        if (res.dead) toast.error(t('status.dead'))
        else if (!res.found) toast.info(t('alias.none'))
      } catch {
        toast.error(t('common.error'))
      } finally {
        setRowBusy((m) => ({ ...m, [alias.id]: undefined }))
      }
    },
    [t, toast],
  )

  const rows = data?.rows || []
  const spot = useMemo(() => rowSpotlight('.mh-lrow'), [])

  let body
  if (listState === 'loading') body = <EnvelopeSkeleton rows={6} label={t('common.loading')} />
  else if (listState === 'error' && rows.length === 0)
    body = (
      <EmptyState
        pose="search"
        tone="danger"
        icon={AlertTriangle}
        title={t('common.error')}
        action={
          <button type="button" className="mh-btn mh-btn--ghost" onClick={load}>
            <RotateCcw size={14} aria-hidden />
            {t('common.retry')}
          </button>
        }
      />
    )
  else if (rows.length === 0) body = <EmptyState pose="search" title={t('aliases.empty')} desc={q ? t('hm.aliases.emptyDesc') : undefined} />
  else
    body = (
      <ul className={`mh-llist ${listState === 'refreshing' ? 'is-busy' : ''}`} onMouseMove={spot}>
        {rows.map((alias) => (
          <AliasRow key={alias.id} alias={alias} busy={rowBusy[alias.id]} code={rowCode[alias.id]} q={q} t={t} onCode={onCode} />
        ))}
      </ul>
    )

  return (
    <div className="mh-page">
      <Link to="/hotmail" className="mh-btn mh-btn--quiet mh-btn--sm mh-self-start">
        <ArrowLeft size={15} aria-hidden />
        {t('hm.backToList')}
      </Link>
      <PageHeader title={t('aliases.title')} subtitle={t('aliases.subtitle')} />

      <section className="mh-card mh-tool" aria-label={t('hm.aliases.tools')}>
        <SearchCommand
          compact
          value={q}
          onSearch={(v) => setParam({ q: v || undefined, page: undefined })}
          placeholder={t('aliases.search.placeholder')}
          label={t('overview.search')}
        />
      </section>

      <section className="mh-card mh-atable mh-ltable" aria-labelledby="mh-al-title">
        <header className="mh-atable__head">
          <h2 id="mh-al-title" className="mh-h2">
            {t('aliases.title')}
          </h2>
        </header>
        <div className="mh-atable__pager">
          <Pager data={data || { page: 1, pages: 1, total: 0 }} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
        </div>
        {rows.length > 0 && listState !== 'loading' && (
          <div className="mh-lcols" aria-hidden>
            <span>{t('aliases.col.alias')}</span>
            <span>{t('aliases.col.account')}</span>
            <span>{t('table.lastCode')}</span>
            <span className="mh-acols__end">{t('table.actions')}</span>
          </div>
        )}
        {body}
        {listState !== 'loading' && data && data.pages > 1 && (
          <div className="mh-atable__pager mh-atable__pager--foot">
            <Pager data={data} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
          </div>
        )}
      </section>
    </div>
  )
}

const AliasRow = memo(function AliasRow({ alias, busy, code, q, t, onCode }) {
  const dead = alias.account_status === 'dead'
  const fetched = code && code.found ? code.code : null
  const showCode = fetched ?? alias.last_code
  const showNone = code && !code.found && !code.dead
  return (
    <li className="mh-lrow">
      <div className="mh-lrow__alias">
        <CopyAddr email={alias.alias_email} q={q} />
      </div>
      <div className="mh-lrow__acct">
        <Link to={`/hotmail/accounts/${alias.account_id}`} className="mh-lrow__acct-link" title={alias.account_email}>
          {alias.account_email}
        </Link>
        <StatusPill tone={dead ? 'bad' : 'ok'}>{t(`status.${alias.account_status}`)}</StatusPill>
      </div>
      <div className="mh-arow__foot">
        <div className="mh-lrow__code">
          <CodeCell code={showCode} />
        </div>
        <div className="mh-lrow__acts">
          <span className="mh-arow__acts">
            <ActBtn icon={ArrowUpRight} label={t('action.enter')} to={`/hotmail/accounts/${alias.account_id}`} />
            <ActBtn icon={KeyRound} label={t('alias.code')} showLabel tone="accent" busy={busy} onClick={() => onCode(alias)} />
          </span>
          {fetched && code.subject && (
            <span className="mh-lrow__res" title={code.subject}>
              {code.subject}
            </span>
          )}
          {showNone && <span className="mh-lrow__res is-warn">{t('alias.none')}</span>}
          {code && code.dead && <span className="mh-lrow__res is-bad">{t('alias.dead')}</span>}
        </div>
      </div>
    </li>
  )
})

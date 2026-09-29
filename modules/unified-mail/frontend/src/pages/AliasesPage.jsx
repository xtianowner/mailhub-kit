import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, KeyRound, LogIn } from 'lucide-react'
import { api } from '../lib/api.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button, Badge, Card, CopyCode } from '../components/ui.jsx'
import { Pager, PAGE_SIZE_OPTIONS } from '../components/Pager.jsx'
import { StateBlock } from '../components/StateBlock.jsx'

export default function AliasesPage() {
  const { t } = useLocale()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') || ''
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
  const rawSize = parseInt(params.get('size') || '50', 10)
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawSize) ? rawSize : 50

  const [searchInput, setSearchInput] = useState(q)
  const [data, setData] = useState(null) // {rows,total,page,pages}
  const [listState, setListState] = useState('loading')
  const [rowBusy, setRowBusy] = useState({}) // id -> true
  const [rowCode, setRowCode] = useState({}) // id -> {found,code,message?,subject?}

  const load = useCallback(async () => {
    setListState('loading')
    try {
      const res = await api.aliases({ q: q || undefined, page, page_size: pageSize })
      setData(res)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [q, page, pageSize])

  useEffect(() => {
    load()
  }, [load])
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
  const onPage = (p) => {
    setParam({ page: p > 1 ? p : undefined })
    scrollTop()
  }
  const onPageSize = (n) => {
    setParam({ size: n === 50 ? undefined : n, page: undefined })
    scrollTop()
  }

  const onCode = async (alias) => {
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
  }

  const rows = data?.rows || []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-text">{t('aliases.title')}</h1>
        <p className="text-sm text-muted">{t('aliases.subtitle')}</p>
      </div>

      <Card className="flex items-center gap-2 p-3">
        <form onSubmit={onSearch} className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('aliases.search.placeholder')}
              className="h-10 w-full rounded border border-border bg-surface-2/60 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </div>
          <Button type="submit" variant="solid">
            {t('overview.search')}
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border/70 px-4 py-3">
          <Pager
            data={data || { page: 1, pages: 1, total: 0 }}
            pageSize={pageSize}
            onPage={onPage}
            onPageSize={onPageSize}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs font-medium uppercase tracking-wide text-subtle">
                <th className="px-4 py-2.5 align-middle font-medium">{t('aliases.col.alias')}</th>
                <th className="w-[260px] px-3 py-2.5 align-middle font-medium">
                  {t('aliases.col.account')}
                </th>
                <th className="w-[150px] px-3 py-2.5 align-middle font-medium">{t('table.lastCode')}</th>
                <th className="w-[260px] px-4 py-2.5 text-right align-middle font-medium">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {listState === 'ready' && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="align-middle">
                    <StateBlock state="empty" message={t('aliases.empty')} />
                  </td>
                </tr>
              )}
              {listState === 'loading' && (
                <tr>
                  <td colSpan={4} className="align-middle">
                    <StateBlock state="loading" />
                  </td>
                </tr>
              )}
              {listState === 'error' && (
                <tr>
                  <td colSpan={4} className="align-middle">
                    <StateBlock state="error" onRetry={load} />
                  </td>
                </tr>
              )}
              {listState === 'ready' &&
                rows.map((alias) => (
                  <AliasRow
                    key={alias.id}
                    alias={alias}
                    busy={rowBusy[alias.id]}
                    code={rowCode[alias.id]}
                    t={t}
                    onCode={onCode}
                  />
                ))}
            </tbody>
          </table>
        </div>

        {listState === 'ready' && data && data.pages > 1 && (
          <div className="border-t border-border/70 px-4 py-3">
            <Pager data={data} pageSize={pageSize} onPage={onPage} onPageSize={onPageSize} />
          </div>
        )}
      </Card>
    </div>
  )
}

function AliasRow({ alias, busy, code, t, onCode }) {
  const dead = alias.account_status === 'dead'
  // after pressing 接码: show fetched result; else fall back to stored last_code
  const fetched = code && code.found ? code.code : null
  const showCode = fetched ?? alias.last_code
  const showNone = code && !code.found && !code.dead

  return (
    <tr className="border-b border-border/50 align-top transition-colors duration-fast hover:bg-surface-2/40">
      <td className="max-w-[320px] px-4 py-2.5 align-middle">
        <span className="block truncate font-mono text-sm text-text" title={alias.alias_email}>
          {alias.alias_email}
        </span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-center gap-2">
          <Link
            to={`/hotmail/accounts/${alias.account_id}`}
            className="min-w-0 truncate text-sm text-muted hover:text-accent"
            title={alias.account_email}
          >
            {alias.account_email}
          </Link>
          <Badge tone={dead ? 'danger' : 'success'} dot className="shrink-0">
            {t(`status.${alias.account_status}`)}
          </Badge>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-middle">
        {showCode ? <CopyCode code={showCode} size="sm" /> : <span className="text-subtle">—</span>}
      </td>
      <td className="px-4 py-2.5 align-middle">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center justify-end gap-1">
            <Link to={`/hotmail/accounts/${alias.account_id}`}>
              <Button size="sm" variant="ghost" title={t('action.enter')}>
                <LogIn size={13} />
                <span className="hidden xl:inline">{t('action.enter')}</span>
              </Button>
            </Link>
            <Button size="sm" variant="solid" loading={busy} onClick={() => onCode(alias)}>
              {!busy && <KeyRound size={13} />}
              {t('alias.code')}
            </Button>
          </div>
          {/* in-place code result: fetched code (already in the cell) + subject, or "not found" */}
          {fetched && code.subject && (
            <span className="max-w-[230px] truncate text-[11px] text-subtle" title={code.subject}>
              {code.subject}
            </span>
          )}
          {showNone && <span className="text-[11px] text-warning">{t('alias.none')}</span>}
          {code && code.dead && <span className="text-[11px] text-danger">{t('alias.dead')}</span>}
        </div>
      </td>
    </tr>
  )
}

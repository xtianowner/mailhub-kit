import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Copy, Info, KeyRound, MailPlus, Plus, Search, Trash2 } from 'lucide-react'
import { hubApi, IS_CLOUD } from '../lib/hubApi.js'
import { fmtDateTime, fmtRelative } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Badge, Button, Card, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'
import { PageHeader, UpstreamBar, useUpstreams } from '../components/hub.jsx'
import { ComposeMailDialog } from '../components/ComposeMailDialog.jsx'
import { MailboxMetaDialog } from '../components/MailboxMetaDialog.jsx'
import { useCopy } from '../lib/useCopy.js'

// 域名邮箱页：管自有域名上的信箱。
// Worker 提供 /admin/mailboxes 时，这张表以**线上真实存在的信箱**为准，
// 本地只保存用户写的备注/分组；如果接口不可用，页面只显示手动登记过的地址并明确提示范围。
export default function DomainMailPage() {
  const { t, locale } = useLocale()
  const toast = useToast()
  const copy = useCopy()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') || ''
  const [searchInput, setSearchInput] = useState(q)
  const [rows, setRows] = useState([])
  const [listState, setListState] = useState('loading')
  const [domains, setDomains] = useState({ domains: [], cfmail_configured: true })
  const { upstreams, state: upState, workerDiscovery, reload: reloadUp } = useUpstreams()
  const [truncated, setTruncated] = useState(false)
  const [rowBusy, setRowBusy] = useState({})
  const [rowCode, setRowCode] = useState({})
  const [composeOpen, setComposeOpen] = useState(false)
  const [editingMailbox, setEditingMailbox] = useState(null)

  const load = useCallback(async () => {
    setListState('loading')
    try {
      const res = await hubApi.mailboxes({ q: q || undefined, source: 'domain', limit: 1000 })
      setTruncated(!!res.truncated)
      setRows(res.rows || [])
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [q])

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
  useEffect(() => {
    setSearchInput(q)
  }, [q])

  const onSearch = (e) => {
    e.preventDefault()
    const next = new URLSearchParams(params)
    if (searchInput.trim()) next.set('q', searchInput.trim())
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const onGetCode = async (row) => {
    setRowBusy((m) => ({ ...m, [row.email]: 'code' }))
    try {
      const res = await hubApi.code(row.email, 'domain')
      setRowCode((m) => ({ ...m, [row.email]: res }))
      if (res.found) toast.success(t('code.result.found'))
      else toast.info(res.error || t('code.result.none'))
      load()
    } catch (err) {
      toast.error(err?.userMessage || t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [row.email]: undefined }))
    }
  }

  const onRegister = async (row) => {
    setRowBusy((m) => ({ ...m, [row.email]: 'register' }))
    try {
      const at = row.email.lastIndexOf('@')
      await hubApi.createMailbox({ name: row.email.slice(0, at), domain: row.email.slice(at + 1) })
      toast.success(t('dom.registered'))
      await load()
    } catch (err) {
      toast.error(err?.userMessage || t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [row.email]: undefined }))
    }
  }

  const onRemove = async (row) => {
    if (!window.confirm(`${t('dom.remove.confirm')}\n${row.email}`)) return
    setRowBusy((m) => ({ ...m, [row.email]: 'remove' }))
    try {
      await hubApi.unregisterMailbox(row.email)
      toast.info(t('dom.removed'))
      load()
    } catch (err) {
      toast.error(err?.userMessage || t('common.error'))
    } finally {
      setRowBusy((m) => ({ ...m, [row.email]: undefined }))
    }
  }

  const onMetaSaved = (next) => {
    setRows((current) =>
      current.map((row) => (row.email === next.email ? { ...row, ...next } : row)),
    )
  }

  // 云端「收信自动建」的行多一个「登记」按钮。table-fixed 下列宽不随内容变，
  // 按钮组会向左溢出盖住「最近验证码」列 —— 有这种行时按中/英文按钮组实宽（含加载转圈）加宽操作列。
  const showRegister = IS_CLOUD && rows.some((r) => r.status === 'auto')
  const actionsColW = showRegister ? (locale === 'en' ? 'w-[368px]' : 'w-[280px]') : 'w-[176px]'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('dom.title')}
        subtitle={t('dom.subtitle')}
        actions={
          <Button type="button" variant="solid" size="md" onClick={() => setComposeOpen(true)}>
            <MailPlus size={15} aria-hidden />
            {t('compose.open')}
          </Button>
        }
      />

      <UpstreamBar
        upstreams={upstreams}
        state={upState}
        onRetry={reloadUp}
        workerDiscovery={workerDiscovery}
      />

      {!domains.cfmail_configured && (
        <Card className="flex items-start gap-2.5 border-warning/30 bg-warning/5 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-muted">{t('dom.unconfigured')}</p>
        </Card>
      )}

      <AddMailbox domains={domains} onDone={load} t={t} />

      <form onSubmit={onSearch} className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('dom.search.placeholder')}
            aria-label={t('overview.search')}
            className="h-10 w-full rounded border border-border bg-surface-2/60 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </div>
        <Button type="submit" variant="solid" size="md">
          {t('overview.search')}
        </Button>
      </form>

      <p
        className={`inline-flex items-start gap-1.5 text-xs ${
          workerDiscovery === false ? 'text-warning' : 'text-subtle'
        }`}
      >
        {workerDiscovery === false ? (
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
        ) : (
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        )}
        {t(workerDiscovery === false ? 'dom.legacyNote' : 'dom.registryNote')}
        {listState === 'ready' && rows.length > 0 && (
          <span className="text-subtle">
            · {t('dom.count', { n: rows.length })}
            {truncated ? ` · ${t('dom.truncated')}` : ''}
          </span>
        )}
      </p>

      <Card className="overflow-hidden">
        {listState !== 'ready' ? (
          <StateBlock state={listState} onRetry={load} />
        ) : rows.length === 0 ? (
          <StateBlock state="empty" message={t('dom.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs font-medium text-subtle">
                  <th className="w-[240px] px-4 py-2.5 align-middle">{t('dom.col.email')}</th>
                  <th className="px-2 py-2.5 align-middle">{t('dom.col.label')}</th>
                  <th className="w-[110px] px-2 py-2.5 align-middle">{t('dom.col.lastMail')}</th>
                  <th className="w-[132px] px-2 py-2.5 align-middle">{t('dom.col.lastCode')}</th>
                  <th className={`${actionsColW} px-4 py-2.5 text-right align-middle`}>
                    {t('table.actions') !== 'table.actions' ? t('table.actions') : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => {
                  const fresh = rowCode[r.email]
                  const code = fresh?.found ? fresh.code : r.last_code
                  return (
                    <tr
                      key={r.email}
                      tabIndex={0}
                      aria-label={t('dom.edit.rowLabel', { email: r.email })}
                      onClick={() => setEditingMailbox(r)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setEditingMailbox(r)
                        }
                      }}
                      className="cursor-pointer align-middle hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    >
                      <td className="px-4 py-2.5 align-middle" title={r.email}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              copy(r.email, { successMsg: t('dom.email.copied') })
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            aria-label={t('dom.email.copy', { email: r.email })}
                            title={t('dom.email.copy', { email: r.email })}
                            className="group inline-flex min-w-0 max-w-full cursor-pointer items-start gap-1.5 rounded px-1 py-1 text-left font-mono text-xs text-text transition-colors duration-fast hover:bg-surface-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          >
                            <span className="min-w-0 break-all whitespace-normal leading-relaxed">{r.email}</span>
                            <Copy size={13} className="mt-0.5 shrink-0 text-subtle group-hover:text-accent" aria-hidden />
                          </button>
                          {r.status === 'discovered' && (
                            <Badge tone="info" className="shrink-0 px-1.5 py-0 text-[10px]">
                              {t('dom.status.discovered')}
                            </Badge>
                          )}
                          {r.status === 'auto' && (
                            <Badge tone="accent" className="shrink-0 px-1.5 py-0 text-[10px]">
                              {t('dom.status.auto')}
                            </Badge>
                          )}
                          {r.status === 'local-only' && (
                            <Badge tone="warning" className="shrink-0 px-1.5 py-0 text-[10px]">
                              {t('dom.status.localOnly')}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="truncate px-2 py-2.5 align-middle text-xs text-muted">
                        <div className="flex items-center gap-1.5">
                          {r.group && (
                            <Badge tone="subtle" className="shrink-0">
                              {r.group}
                            </Badge>
                          )}
                          <span className="truncate" title={r.label || ''}>
                            {r.label || <span className="text-subtle">—</span>}
                          </span>
                        </div>
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-2.5 align-middle tabular-nums text-xs text-subtle"
                        title={fmtDateTime(r.last_mail_at)}
                      >
                        {r.last_mail_at ? fmtRelative(r.last_mail_at, locale) : '—'}
                      </td>
                      <td className="px-2 py-2.5 align-middle">
                        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                          {code ? <CopyCode code={code} size="sm" /> : <span className="text-subtle">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          {IS_CLOUD && r.status === 'auto' && (
                            <Button size="sm" variant="ghost" loading={rowBusy[r.email] === 'register'}
                              onClick={(event) => { event.stopPropagation(); onRegister(r) }}>
                              <MailPlus size={13} />{t('dom.register')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="solid"
                            loading={rowBusy[r.email] === 'code'}
                            onClick={(event) => {
                              event.stopPropagation()
                              onGetCode(r)
                            }}
                          >
                            <KeyRound size={13} />
                            {t('dom.getCode')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/inbox?q=${encodeURIComponent(r.email)}&source=domain`)
                            }}
                          >
                            {t('dom.viewMails')}
                          </Button>
                          {/* 低频操作，保持文字级权重，不与高频的「接码」争视觉 */}
                          <button
                            type="button"
                            title={t('dom.remove')}
                            aria-label={`${t('dom.remove')} ${r.email}`}
                            disabled={rowBusy[r.email] === 'remove'}
                            onClick={(event) => {
                              event.stopPropagation()
                              onRemove(r)
                            }}
                            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-subtle transition-colors duration-fast hover:bg-surface-2 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ComposeMailDialog open={composeOpen} onClose={() => setComposeOpen(false)} />
      <MailboxMetaDialog
        mailbox={editingMailbox}
        onClose={() => setEditingMailbox(null)}
        onSaved={onMetaSaved}
      />
    </div>
  )
}

/* ── 新建信箱 ──────────────────────────────────────────────── */
function AddMailbox({ domains, onDone, t }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '', label: '', group: '' })

  const domainList = domains.domains || []
  useEffect(() => {
    if (!form.domain && domainList.length) setForm((f) => ({ ...f, domain: domainList[0] }))
  }, [domainList, form.domain])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (!form.name.trim()) return
      await hubApi.createMailbox({
        name: form.name.trim(),
        domain: form.domain,
        label: form.label || undefined,
        group: form.group || undefined,
      })
      toast.success(t('dom.created'))
      setForm((f) => ({ ...f, name: '', label: '', group: '' }))
      onDone()
    } catch (err) {
      toast.error(err?.userMessage || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'h-10 w-full rounded border border-border bg-surface-2/60 px-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40'

  return (
    <Card className="flex flex-col gap-3.5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 font-heading text-sm font-semibold text-text">{t('dom.add.title')}</h2>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
        <>
          <input
            value={form.name}
            onChange={set('name')}
            placeholder={t('dom.add.localPart')}
            aria-label={t('dom.add.localPart')}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
          />
          <select
            value={form.domain}
            onChange={set('domain')}
            aria-label={t('dom.add.domain')}
            className={`${inputCls} cursor-pointer`}
          >
            {domainList.map((d) => (
              <option key={d} value={d}>
                @{d}
              </option>
            ))}
          </select>
        </>

        <input
          value={form.label}
          onChange={set('label')}
          placeholder={t('dom.add.label')}
          aria-label={t('dom.add.label')}
          className={inputCls}
        />
        <input
          value={form.group}
          onChange={set('group')}
          placeholder={t('dom.add.group')}
          aria-label={t('dom.add.group')}
          className={inputCls}
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={busy}
          disabled={!domains.cfmail_configured}
        >
          <Plus size={15} />
          {t('dom.add.submitCreate')}
        </Button>
      </form>
    </Card>
  )
}

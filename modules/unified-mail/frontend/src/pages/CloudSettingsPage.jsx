import { useCallback, useEffect, useState } from 'react'
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { cfApi } from '../lib/cfmailDirect.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { Button, Card } from '../components/ui.jsx'
import { PageHeader } from '../components/hub.jsx'
import { Link } from 'react-router-dom'

// 云端版设置。
//
// 早先这里是「填两把 CFMail 密钥」的表单 —— 那要求用户在每台设备上背两串 40+ 字符
// 的 token。现在密钥只活在网关 Worker 的加密环境变量里，浏览器一次都碰不到，
// 收信设置持久化到云端，本地版与云端版共享。
export default function CloudSettingsPage() {
  const { t } = useLocale()
  const toast = useToast()
  const { logout } = useAuth()

  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)

  const test = useCallback(async () => {
    setTesting(true)
    try {
      const h = await cfApi.health()
      const up = h.upstreams?.[0]
      if (up?.ok) setResult({ ok: true, domains: h.domain_suffixes || [] })
      else setResult({ ok: false, detail: up?.detail || t('common.error') })
    } catch (err) {
      setResult({ ok: false, detail: err?.userMessage || t('common.error') })
    } finally {
      setTesting(false)
    }
  }, [t])

  useEffect(() => {
    test()
  }, [test])

  const onLogout = async () => {
    await logout()
    toast.info(t('auth.loggedOut'))
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title={t('cloud.title')} subtitle={t('cloud.subtitle')} />

      <ReceivingSettings />

      <Card className="flex items-start gap-2.5 border-success/25 bg-success/5 px-4 py-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <p className="text-sm text-muted">{t('cloud.security')}</p>
      </Card>

      <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div
          className={`rounded border px-3 py-2.5 text-sm ${
            testing
              ? 'border-border bg-surface-2/50 text-muted'
              : result?.ok
                ? 'border-success/25 bg-success/10 text-success'
                : 'border-danger/25 bg-danger/10 text-danger'
          }`}
          aria-live="polite"
        >
          {testing ? (
            t('common.loading')
          ) : result?.ok ? (
            <>
              {t('cloud.ok')} · {result.domains.length} {t('cloud.domains')}
              {result.domains.length ? (
                <span className="ml-1 font-mono text-xs opacity-80">
                  （{result.domains.join(' / ')}）
                </span>
              ) : null}
            </>
          ) : (
            <>
              {t('cloud.fail')}：{result?.detail || t('common.error')}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="md" onClick={test} loading={testing}>
            <RefreshCw size={15} />
            {t('cloud.refresh')}
          </Button>
          <button
            type="button"
            onClick={onLogout}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-subtle transition-colors duration-fast hover:text-danger"
          >
            <LogOut size={13} />
            {t('cloud.logout')}
          </button>
        </div>
      </Card>

      <p className="text-xs text-subtle">{t('cloud.where')}</p>
    </div>
  )
}

function ReceivingSettings() {
  const { t } = useLocale()
  const toast = useToast()
  const [current, setCurrent] = useState(null)
  const [selected, setSelected] = useState('registered')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await cfApi.receivingSettings()
      setCurrent(data.receive_mode)
      setSelected(data.receive_mode)
    } catch (err) {
      setError(err?.userMessage || t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const data = await cfApi.saveReceivingSettings(selected)
      setCurrent(data.receive_mode)
      setSelected(data.receive_mode)
      toast.success(t('receiving.saved'))
    } catch (err) {
      setError(err?.userMessage || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold text-text">{t('receiving.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('receiving.scope')}</p>
      </div>
      {loading ? <p aria-live="polite" className="text-sm text-muted">{t('common.loading')}</p> : (
        <>
          <fieldset disabled={saving || current === null} className="flex flex-col gap-3">
            <legend className="sr-only">{t('receiving.title')}</legend>
            {['registered', 'auto'].map((mode) => (
              <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${
                selected === mode ? 'border-accent bg-accent/10' : 'border-border bg-surface-2/40'
              }`}>
                <input type="radio" name="receive-mode" value={mode}
                  checked={selected === mode} onChange={() => setSelected(mode)}
                  className="mt-1 accent-accent" />
                <span>
                  <span className="text-sm font-medium text-text">{t(`receiving.${mode}`)}</span>
                  {current === mode && <span className="ml-2 text-xs text-success">{t('receiving.active')}</span>}
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{t(`receiving.${mode}.hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-relaxed text-muted">{t('receiving.history')}</p>
          {selected === 'auto' && <p className="text-sm text-warning">{t('receiving.warning')}</p>}
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} loading={saving}
          disabled={loading || current === null || selected === current}>{t('receiving.save')}</Button>
        <Button variant="ghost" onClick={load} disabled={loading || saving}>{t('receiving.reload')}</Button>
        <Link to="/domain" className="ml-auto text-sm text-accent hover:underline">{t('receiving.register')}</Link>
      </div>
      <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted">{t('receiving.loginProtection')}</p>
    </Card>
  )
}

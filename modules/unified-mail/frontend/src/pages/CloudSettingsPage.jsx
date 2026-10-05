import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Inbox, LogOut, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { cfApi } from '../lib/cfmailDirect.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { SettingsFrame, useSettingsSection } from '../components/SettingsFrame.jsx'

// 云端版设置。功能与改版前完全相同：收信模式切换（云端与本地同步）、连接测试、登出、安全说明。
// 密钥只活在网关 Worker 的加密环境变量里，浏览器一次都碰不到。
// 改版只是把它们分成两个子页（收信模式 / 连接与安全）放进侧栏子导航框架。
// 连接测试和改版前一样，打开设置页就测一次（不论停在哪个子页），之后只在点「重新检测连接」时再测。
export default function CloudSettingsPage() {
  const { t } = useLocale()
  const sections = [
    { key: 'receiving', icon: Inbox, label: t('receiving.title'), desc: t('receiving.scope') },
    { key: 'connection', icon: PlugZap, label: t('st.connection') },
  ]
  const current = useSettingsSection(sections)
  const conn = useConnectionTest()
  return (
    <SettingsFrame title={t('cloud.title')} subtitle={t('cloud.subtitle')} sections={sections} current={current}>
      {current === 'receiving' ? <ReceivingSettings /> : <Connection {...conn} />}
    </SettingsFrame>
  )
}

function useConnectionTest() {
  const { t } = useLocale()
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
  return { testing, result, test }
}

function Connection({ testing, result, test }) {
  const { t, tn } = useLocale()
  const toast = useToast()
  const { logout } = useAuth()

  const onLogout = async () => {
    await logout()
    toast.info(t('auth.loggedOut'))
  }

  const tone = testing ? 'muted' : result?.ok ? 'ok' : 'bad'
  return (
    <div className="mh-form mh-form--settings">
      <div className={`mh-conn mh-conn--${tone}`} aria-live="polite">
        {testing ? (
          <>
            <RefreshCw size={16} className="mh-spin" aria-hidden />
            <span>{t('common.loading')}</span>
          </>
        ) : result?.ok ? (
          <>
            <CheckCircle2 size={16} aria-hidden />
            <span>
              {t('cloud.ok')} · {tn('cloud.domains', result.domains.length)}
              {result.domains.length ? <span className="mh-conn__list">{t('cloud.domains.list', { list: result.domains.join(' / ') })}</span> : null}
            </span>
          </>
        ) : (
          <>
            <AlertTriangle size={16} aria-hidden />
            <span>{t('cloud.failDetail', { label: t('cloud.fail'), detail: result?.detail || t('common.error') })}</span>
          </>
        )}
      </div>

      <div className="mh-form__actions">
        <button type="button" className="mh-btn mh-btn--quiet" onClick={test} disabled={testing}>
          <RefreshCw size={15} className={testing ? 'mh-spin' : ''} aria-hidden />
          {t('cloud.refresh')}
        </button>
      </div>

      <p className="mh-note mh-note--ok mh-note--box">
        <ShieldCheck size={15} aria-hidden />
        <span>{t('cloud.security')}</span>
      </p>
      <p className="mh-help">{t('cloud.where')}</p>

      <div className="mh-danger-zone">
        <span className="mh-help">{t('st.logout.desc')}</span>
        <button type="button" className="mh-btn mh-btn--quiet mh-btn--sm mh-btn--to-danger" onClick={onLogout}>
          <LogOut size={14} aria-hidden />
          {t('cloud.logout')}
        </button>
      </div>
    </div>
  )
}

function ReceivingSettings() {
  const { t } = useLocale()
  const toast = useToast()
  const id = useId()
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

  useEffect(() => {
    load()
  }, [load])

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
    <div className="mh-form mh-form--settings">
      {loading ? (
        <EnvelopeSkeleton rows={2} label={t('common.loading')} />
      ) : (
        <>
          <fieldset disabled={saving || current === null} className="mh-choices">
            <legend className="sr-only">{t('receiving.title')}</legend>
            {['registered', 'auto'].map((mode) => (
              <label key={mode} className={`mh-choice ${selected === mode ? 'is-on' : ''}`} htmlFor={`${id}-${mode}`}>
                <input
                  id={`${id}-${mode}`}
                  type="radio"
                  name={`${id}-receive-mode`}
                  value={mode}
                  checked={selected === mode}
                  onChange={() => setSelected(mode)}
                />
                <span className="mh-choice__text">
                  <span className="mh-choice__title">
                    {t(`receiving.${mode}`)}
                    {current === mode && <span className="mh-pill mh-pill--ok">{t('receiving.active')}</span>}
                  </span>
                  <span className="mh-choice__desc">{t(`receiving.${mode}.hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="mh-help">{t('receiving.history')}</p>
          {selected === 'auto' && (
            <p className="mh-note mh-note--warn mh-note--box">
              <AlertTriangle size={14} aria-hidden />
              <span>{t('receiving.warning')}</span>
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mh-formerr">
          <AlertTriangle size={15} aria-hidden />
          <span>{error}</span>
        </p>
      )}
      <div className="mh-form__actions">
        <button type="button" className="mh-btn mh-btn--primary" onClick={save} disabled={saving || loading || current === null || selected === current}>
          {saving && <span className="mh-btn__spin" aria-hidden />}
          {t('receiving.save')}
        </button>
        <button type="button" className="mh-btn mh-btn--quiet" onClick={load} disabled={loading || saving}>
          {t('receiving.reload')}
        </button>
        <Link to="/domain" className="mh-linkbtn mh-form__end">
          {t('receiving.register')}
        </Link>
      </div>
      <p className="mh-help mh-help--sep">{t('receiving.loginProtection')}</p>
    </div>
  )
}

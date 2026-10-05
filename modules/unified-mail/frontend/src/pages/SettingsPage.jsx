import { useEffect, useId, useState } from 'react'
import { AlertTriangle, HeartPulse, Inbox, RotateCcw, Save } from 'lucide-react'
import { api } from '../lib/api.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { EnvelopeSkeleton } from '../components/EnvelopeSkeleton.jsx'
import { SettingsFrame, useSettingsSection } from '../components/SettingsFrame.jsx'

// 本地版设置（Hotmail 侧）：字段、读取、保存与改版前完全相同 —— 一份表单，api.saveSettings 一次存全部字段。
// 只是按用途分成两个子页（收信 / 账号保活）放进侧栏子导航框架。
const FIELDS = {
  receive: [
    { key: 'poll_interval_seconds', label: 'settings.poll', type: 'number' },
    { key: 'watch_folders', label: 'settings.folders', type: 'text', hint: 'settings.hint.folders' },
    { key: 'default_search_keywords', label: 'settings.keywords', type: 'textarea' },
  ],
  keepalive: [{ key: 'keepalive_days', label: 'settings.keepalive', type: 'number', hint: 'st.keepalive.hint' }],
}

export default function SettingsPage() {
  const { t } = useLocale()
  const toast = useToast()
  const id = useId()
  const [form, setForm] = useState(null)
  const [state, setState] = useState('loading')
  const [saving, setSaving] = useState(false)

  const sections = [
    { key: 'receive', icon: Inbox, label: t('st.receive'), desc: t('st.receive.desc') },
    { key: 'keepalive', icon: HeartPulse, label: t('st.keepalive'), desc: t('st.keepalive.desc') },
  ]
  const current = useSettingsSection(sections)

  const load = async () => {
    setState('loading')
    try {
      setForm(await api.settings())
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveSettings(form)
      toast.success(t('settings.saved'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  let body
  if (state === 'loading') body = <EnvelopeSkeleton rows={3} label={t('common.loading')} />
  else if (state === 'error' || !form)
    body = (
      <p className="mh-formerr" role="alert">
        <AlertTriangle size={15} aria-hidden />
        <span>{t('common.error')}</span>
        <button type="button" className="mh-linkbtn" onClick={load}>
          <RotateCcw size={13} aria-hidden />
          {t('common.retry')}
        </button>
      </p>
    )
  else
    body = (
      <form onSubmit={onSave} className="mh-form mh-form--settings">
        {FIELDS[current].map((f) => {
          const fid = `${id}-${f.key}`
          return (
            <div key={f.key} className="mh-field">
              <label className="mh-label" htmlFor={fid}>
                {t(f.label)}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  id={fid}
                  value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={3}
                  className="mh-input mh-input--area"
                  aria-describedby={f.hint ? `${fid}-hint` : undefined}
                />
              ) : (
                <input
                  id={fid}
                  type={f.type}
                  value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={`mh-input ${f.type === 'number' ? 'mh-input--num' : ''}`}
                  aria-describedby={f.hint ? `${fid}-hint` : undefined}
                />
              )}
              {f.hint && (
                <span id={`${fid}-hint`} className="mh-help">
                  {t(f.hint)}
                </span>
              )}
            </div>
          )
        })}
        <div className="mh-form__actions">
          <button type="submit" className="mh-btn mh-btn--primary" disabled={saving}>
            {saving ? <span className="mh-btn__spin" aria-hidden /> : <Save size={15} aria-hidden />}
            {t('settings.save')}
          </button>
          <span className="mh-help">{t('st.saveAll')}</span>
        </div>
      </form>
    )

  return (
    <SettingsFrame title={t('settings.title')} subtitle={t('st.subtitle')} sections={sections} current={current}>
      {body}
    </SettingsFrame>
  )
}

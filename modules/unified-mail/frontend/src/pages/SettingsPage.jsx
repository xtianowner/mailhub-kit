import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api } from '../lib/api.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button, Card } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'

const FIELDS = [
  { key: 'poll_interval_seconds', label: 'settings.poll', type: 'number' },
  { key: 'watch_folders', label: 'settings.folders', type: 'text', hint: 'settings.hint.folders' },
  { key: 'default_search_keywords', label: 'settings.keywords', type: 'textarea' },
  { key: 'keepalive_days', label: 'settings.keepalive', type: 'number' },
]

export default function SettingsPage() {
  const { t } = useLocale()
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [state, setState] = useState('loading')
  const [saving, setSaving] = useState(false)

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

  if (state === 'loading') return <StateBlock state="loading" />
  if (state === 'error' || !form) return <StateBlock state="error" onRetry={load} />

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <h1 className="font-heading text-xl font-semibold text-text">{t('settings.title')}</h1>
      <Card className="p-5">
        <form onSubmit={onSave} className="flex flex-col gap-5">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text">{t(f.label)}</span>
              {f.type === 'textarea' ? (
                <textarea
                  value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded border border-border bg-surface-2/60 px-3 py-2 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              ) : (
                <input
                  type={f.type}
                  value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="h-10 w-full rounded border border-border bg-surface-2/60 px-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              )}
              {f.hint && <span className="text-xs text-subtle">{t(f.hint)}</span>}
            </label>
          ))}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              <Save size={15} /> {t('settings.save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

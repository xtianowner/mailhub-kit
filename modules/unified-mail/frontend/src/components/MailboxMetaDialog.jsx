import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Pencil, X } from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button } from './ui.jsx'

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function MailboxMetaDialog({ mailbox, onClose, onSaved }) {
  const { t } = useLocale()
  const toast = useToast()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const [form, setForm] = useState({ label: '', group: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    busyRef.current = busy
    onCloseRef.current = onClose
  }, [busy, onClose])

  useEffect(() => {
    if (!mailbox) return
    setForm({ label: mailbox.label || '', group: mailbox.group || '' })
    setBusy(false)
    setError('')
  }, [mailbox])

  useEffect(() => {
    if (!mailbox) return
    restoreFocusRef.current = document.activeElement

    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`

    const frame = requestAnimationFrame(() => closeRef.current?.focus())
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault()
        if (!busyRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
      restoreFocusRef.current?.focus?.()
    }
  }, [mailbox])

  if (!mailbox || typeof document === 'undefined') return null

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    if (error) setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const next = { label: form.label.trim(), group: form.group.trim() }
    setBusy(true)
    setError('')
    try {
      await hubApi.setMailboxMeta(mailbox.email, next)
      toast.success(t('dom.edit.saved'))
      onSaved({ email: mailbox.email, ...next })
      onClose()
    } catch (err) {
      setError(err?.userMessage || t('dom.edit.error'))
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'h-10 w-full rounded border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60'

  return createPortal(
    <div
      className="overlay-in fixed inset-0 z-overlay flex items-end justify-center bg-bg/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="dialog-in z-modal flex w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-lift sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 font-heading text-lg font-semibold text-heading">
              <Pencil size={18} className="shrink-0 text-accent" aria-hidden />
              {t('dom.edit.title')}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {t('dom.edit.subtitle')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('dom.edit.close')}
            title={`${t('dom.edit.close')} (Esc)`}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <form onSubmit={submit} className="flex flex-col">
          <div className="space-y-4 px-4 py-4 sm:px-5">
            <div>
              <label htmlFor={`${titleId}-email`} className="mb-1.5 block text-sm font-medium text-text">
                {t('dom.edit.email')}
              </label>
              <input
                id={`${titleId}-email`}
                value={mailbox.email}
                readOnly
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label htmlFor={`${titleId}-label`} className="mb-1.5 block text-sm font-medium text-text">
                {t('dom.edit.label')}
              </label>
              <input
                id={`${titleId}-label`}
                value={form.label}
                onChange={update('label')}
                maxLength={200}
                placeholder={t('dom.add.label')}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`${titleId}-group`} className="mb-1.5 block text-sm font-medium text-text">
                {t('dom.edit.group')}
              </label>
              <input
                id={`${titleId}-group`}
                value={form.group}
                onChange={update('group')}
                maxLength={100}
                placeholder={t('dom.add.group')}
                className={inputClass}
              />
            </div>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-text">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                <span>{error}</span>
              </p>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
            <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={busy}>
              {t('dom.edit.cancel')}
            </Button>
            <Button type="submit" variant="solid" size="md" loading={busy}>
              {t(busy ? 'dom.edit.saving' : 'dom.edit.save')}
            </Button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  )
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Mail, RefreshCw, Send, X } from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button, Spinner } from './ui.jsx'

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

function normalizedInitial(initialValues = {}) {
  return {
    from_address: initialValues.from_address || '',
    to: initialValues.to || '',
    subject: initialValues.subject || '',
    text: initialValues.text || '',
    reply_to_message_id: initialValues.reply_to_message_id || '',
  }
}

export function ComposeMailDialog({ open, onClose, initialValues, mode = 'compose' }) {
  const { t } = useLocale()
  const toast = useToast()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()
  const initialFrom = initialValues?.from_address || ''
  const initialTo = initialValues?.to || ''
  const initialSubject = initialValues?.subject || ''
  const initialText = initialValues?.text || ''
  const initialReplyId = initialValues?.reply_to_message_id || ''

  const [form, setForm] = useState(() => normalizedInitial(initialValues))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [statusState, setStatusState] = useState('loading')
  const [sending, setSending] = useState({
    available: false,
    binding_configured: false,
    domains: [],
    from_addresses: [],
  })

  useEffect(() => {
    busyRef.current = busy
    onCloseRef.current = onClose
  }, [busy, onClose])

  const loadStatus = useCallback(async () => {
    setStatusState('loading')
    setSubmitError('')
    try {
      const next = await hubApi.sendingStatus()
      setSending({
        available: Boolean(next?.available),
        binding_configured: Boolean(next?.binding_configured),
        domains: next?.domains || [],
        from_addresses: next?.from_addresses || [],
      })
      setForm((current) => ({
        ...current,
        from_address: current.from_address || next?.from_addresses?.[0] || '',
      }))
      setStatusState('ready')
    } catch (error) {
      setSubmitError(error?.userMessage || t('compose.status.error'))
      setStatusState('error')
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    setForm(
      normalizedInitial({
        from_address: initialFrom,
        to: initialTo,
        subject: initialSubject,
        text: initialText,
        reply_to_message_id: initialReplyId,
      }),
    )
    setErrors({})
    setSubmitError('')
    setBusy(false)
  }, [open, initialFrom, initialTo, initialSubject, initialText, initialReplyId])

  useEffect(() => {
    if (open) loadStatus()
  }, [open, loadStatus])

  useEffect(() => {
    if (!open) return
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
  }, [open])

  const fromAddresses = useMemo(() => {
    const unique = new Set(sending.from_addresses)
    if (form.from_address) unique.add(form.from_address)
    return [...unique]
  }, [sending.from_addresses, form.from_address])

  const validateField = (name, value) => {
    if (name === 'from_address' && !EMAIL_RE.test(value.trim())) return t('compose.error.from')
    if (name === 'to' && !EMAIL_RE.test(value.trim())) return t('compose.error.to')
    if (name === 'text' && !value.trim()) return t('compose.error.body')
    return ''
  }

  const updateField = (name) => (event) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [name]: value }))
    if (errors[name]) {
      setErrors((current) => ({ ...current, [name]: validateField(name, value) }))
    }
    if (submitError) setSubmitError('')
  }

  const onBlur = (name) => () => {
    const message = validateField(name, form[name])
    if (message) setErrors((current) => ({ ...current, [name]: message }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const nextErrors = {
      from_address: validateField('from_address', form.from_address),
      to: validateField('to', form.to),
      text: validateField('text', form.text),
    }
    const cleanErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, value]) => value))
    setErrors(cleanErrors)
    if (Object.keys(cleanErrors).length) {
      dialogRef.current?.querySelector('[aria-invalid="true"]')?.focus()
      return
    }

    setBusy(true)
    setSubmitError('')
    try {
      await hubApi.sendDomainMail({
        from_address: form.from_address.trim(),
        to: form.to.trim(),
        subject: form.subject.trim(),
        text: form.text,
        reply_to_message_id: form.reply_to_message_id || undefined,
      })
      toast.success(t(mode === 'reply' ? 'compose.reply.success' : 'compose.success'))
      onClose()
    } catch (error) {
      setSubmitError(error?.userMessage || t('compose.failure'))
    } finally {
      setBusy(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const statusMessage = !sending.binding_configured
    ? t('compose.bindingMissing')
    : t('compose.domainMissing')
  const inputClass =
    'h-10 w-full rounded border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60'
  const textareaClass = `${inputClass} min-h-40 resize-y py-2.5 leading-relaxed`

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
        className="dialog-in z-modal flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-lift sm:max-h-[min(88vh,760px)] sm:rounded-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 font-heading text-lg font-semibold text-heading">
              <Mail size={18} className="shrink-0 text-accent" aria-hidden />
              {t(mode === 'reply' ? 'compose.reply.title' : 'compose.title')}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {t('compose.subtitle')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('compose.close')}
            title={`${t('compose.close')} (Esc)`}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-heading disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {statusState === 'loading' && (
              <div className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted">
                <Spinner size={15} />
                {t('compose.status.loading')}
              </div>
            )}
            {statusState === 'error' && (
              <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-text">
                <AlertCircle size={16} className="shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1">{submitError || t('compose.status.error')}</span>
                <Button type="button" size="sm" variant="ghost" onClick={loadStatus}>
                  <RefreshCw size={13} aria-hidden />
                  {t('compose.status.retry')}
                </Button>
              </div>
            )}
            {statusState === 'ready' && !sending.available && (
              <div role="status" className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-text">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{statusMessage}</span>
              </div>
            )}

            <div>
              <label htmlFor={`${titleId}-from`} className="mb-1.5 block text-sm font-medium text-text">
                {t('compose.from')}
              </label>
              <select
                id={`${titleId}-from`}
                value={form.from_address}
                onChange={updateField('from_address')}
                onBlur={onBlur('from_address')}
                aria-invalid={Boolean(errors.from_address)}
                aria-describedby={errors.from_address ? `${titleId}-from-error` : undefined}
                className={`${inputClass} cursor-pointer font-mono`}
              >
                <option value="">{t('compose.from.placeholder')}</option>
                {fromAddresses.map((address) => (
                  <option key={address} value={address}>{address}</option>
                ))}
              </select>
              <p id={`${titleId}-from-error`} className="min-h-5 pt-1 text-xs text-danger">
                {errors.from_address || ''}
              </p>
            </div>

            <div>
              <label htmlFor={`${titleId}-to`} className="mb-1.5 block text-sm font-medium text-text">
                {t('compose.to')}
              </label>
              <input
                id={`${titleId}-to`}
                type="text"
                inputMode="email"
                value={form.to}
                onChange={updateField('to')}
                onBlur={onBlur('to')}
                aria-invalid={Boolean(errors.to)}
                aria-describedby={errors.to ? `${titleId}-to-error` : undefined}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('compose.to.placeholder')}
                className={`${inputClass} font-mono`}
              />
              <p id={`${titleId}-to-error`} className="min-h-5 pt-1 text-xs text-danger">
                {errors.to || ''}
              </p>
            </div>

            <div>
              <label htmlFor={`${titleId}-subject`} className="mb-1.5 block text-sm font-medium text-text">
                {t('compose.subject')}
              </label>
              <input
                id={`${titleId}-subject`}
                value={form.subject}
                onChange={updateField('subject')}
                maxLength={300}
                placeholder={t('compose.subject.placeholder')}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={`${titleId}-body`} className="mb-1.5 block text-sm font-medium text-text">
                {t('compose.body')}
              </label>
              <textarea
                id={`${titleId}-body`}
                value={form.text}
                onChange={updateField('text')}
                onBlur={onBlur('text')}
                aria-invalid={Boolean(errors.text)}
                aria-describedby={errors.text ? `${titleId}-body-error` : undefined}
                placeholder={t('compose.body.placeholder')}
                className={textareaClass}
              />
              <p id={`${titleId}-body-error`} className="min-h-5 pt-1 text-xs text-danger">
                {errors.text || ''}
              </p>
            </div>

            {submitError && statusState !== 'error' && (
              <p role="alert" className="flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-text">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                <span>{submitError}</span>
              </p>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
            <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={busy}>
              {t('compose.cancel')}
            </Button>
            <Button
              type="submit"
              variant="solid"
              size="md"
              loading={busy}
              disabled={statusState !== 'ready' || !sending.available}
            >
              {!busy && <Send size={15} aria-hidden />}
              {t(busy ? 'compose.sending' : mode === 'reply' ? 'compose.reply.send' : 'compose.send')}
            </Button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  )
}

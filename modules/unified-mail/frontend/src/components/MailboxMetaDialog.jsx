import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Pencil } from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Modal } from './Modal.jsx'
import { Button } from './ui.jsx'

/* 编辑信箱的备注 / 分组（弹窗）。外壳是共用的 Modal：看得见的 ×、Esc、焦点锁定与归还，
   以及「不吞数据的出口」—— 改了备注或分组后点遮罩不关、× / Esc / 取消先问「放弃已经填写的内容？」，
   没改（或改回原样）照常直接关。mailbox 为空 = 关闭。 */
export function MailboxMetaDialog({ mailbox, onClose, onSaved }) {
  const { t } = useLocale()
  const toast = useToast()
  const titleId = useId()
  const [form, setForm] = useState({ label: '', group: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 关闭动画期间 mailbox 已经是 null：沿用上一个信箱的内容，框里的字不会先消失
  const lastRef = useRef(null)
  if (mailbox) lastRef.current = mailbox
  const box = mailbox || lastRef.current

  useEffect(() => {
    if (!mailbox) return
    setForm({ label: mailbox.label || '', group: mailbox.group || '' })
    setBusy(false)
    setError('')
  }, [mailbox])

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    if (error) setError('')
  }

  // 「填了内容」= 备注 / 分组和打开时不一样（保存时会去首尾空白，所以这里也按去空白后比较）
  const dirty =
    Boolean(mailbox) &&
    (form.label.trim() !== (mailbox.label || '').trim() || form.group.trim() !== (mailbox.group || '').trim())

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

  return (
    <Modal
      open={Boolean(mailbox)}
      onClose={onClose}
      title={t('dom.edit.title')}
      icon={Pencil}
      description={t('dom.edit.subtitle')}
      closeLabel={t('dom.edit.close')}
      dirty={dirty}
      busy={busy}
      footer={({ requestClose }) => (
        <span className="mh-modal__actions">
          <Button type="button" variant="ghost" size="md" onClick={() => requestClose('cancel')} disabled={busy}>
            {t('dom.edit.cancel')}
          </Button>
          <Button type="submit" form={`${titleId}-form`} variant="solid" size="md" loading={busy}>
            {t(busy ? 'dom.edit.saving' : 'dom.edit.save')}
          </Button>
        </span>
      )}
    >
      <form id={`${titleId}-form`} onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={`${titleId}-email`} className="mb-1.5 block text-sm font-medium text-text">
            {t('dom.edit.email')}
          </label>
          <input id={`${titleId}-email`} value={box?.email || ''} readOnly className={`${inputClass} font-mono`} />
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
      </form>
    </Modal>
  )
}

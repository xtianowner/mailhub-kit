import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Info, MailPlus } from 'lucide-react'
import { hubApi } from '../../lib/hubApi.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { useToast } from '../../lib/toast.jsx'
import { Modal } from '../Modal.jsx'

/* 新建信箱（弹窗）。调用与改版前完全相同：hubApi.createMailbox({ name, domain, label, group })。
   填了一半被误关也不丢：内容节流写进 sessionStorage 草稿（只有用户名 / 域名 / 备注 / 分组，没有凭据），
   重开时恢复并提示，可一键清空；创建成功或确认放弃后删除草稿。 */
const DRAFT_KEY = 'mailhub:draft:new-mailbox'
const EMPTY = { name: '', domain: '', label: '', group: '' }

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null
  } catch {
    return null
  }
}
function writeDraft(form) {
  try {
    if (form.name || form.label || form.group) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 隐私模式 */
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 隐私模式 */
  }
}

export function CreateMailboxDialog({ open, onClose, domains = [], defaultDomain = '', configured = true, onCreated }) {
  const { t } = useLocale()
  const toast = useToast()
  const id = useId()
  const [form, setForm] = useState(EMPTY)
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saveTimer = useRef(0)

  // 打开时：有草稿就恢复，否则从空表单开始；域名默认取当前所在的域名
  useEffect(() => {
    if (!open) return
    const draft = readDraft()
    const pick = (d) => (d && domains.includes(d) ? d : defaultDomain && domains.includes(defaultDomain) ? defaultDomain : domains[0] || '')
    if (draft) {
      setForm({ ...draft, domain: pick(draft.domain) })
      setRestored(true)
    } else {
      setForm({ ...EMPTY, domain: pick(defaultDomain) })
      setRestored(false)
    }
    setError('')
    setBusy(false)
    // 只在打开的那一刻初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 域名列表晚到时补上默认值
  useEffect(() => {
    if (open && !form.domain && domains.length) setForm((f) => ({ ...f, domain: domains.includes(defaultDomain) ? defaultDomain : domains[0] }))
  }, [open, domains, defaultDomain, form.domain])

  useEffect(() => {
    if (!open) return undefined
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => writeDraft(form), 400)
    return () => clearTimeout(saveTimer.current)
  }, [form, open])

  const dirty = Boolean(form.name.trim() || form.label.trim() || form.group.trim())
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (error) setError('')
  }

  const close = () => {
    clearTimeout(saveTimer.current)
    clearDraft()
    onClose()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError(t('dm.create.needName'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await hubApi.createMailbox({
        name: form.name.trim(),
        domain: form.domain,
        label: form.label || undefined,
        group: form.group || undefined,
      })
      toast.success(t('dom.created'))
      clearTimeout(saveTimer.current)
      clearDraft()
      onCreated?.()
      onClose()
    } catch (err) {
      setError(err?.userMessage || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('dom.add.title')}
      icon={MailPlus}
      description={t('dm.create.desc')}
      dirty={dirty}
      busy={busy}
      footer={({ requestClose }) => (
        <span className="mh-modal__actions">
          <button type="button" className="mh-btn mh-btn--quiet" onClick={() => requestClose('cancel')} disabled={busy}>
            {t('meta.cancel')}
          </button>
          <button type="submit" form={`${id}-form`} className="mh-btn mh-btn--primary" disabled={busy || !configured || !form.domain}>
            {busy && <span className="mh-btn__spin" aria-hidden />}
            {t('dom.add.submitCreate')}
          </button>
        </span>
      )}
    >
      {restored && dirty && (
        <p className="mh-note mh-note--info mh-note--box">
          <Info size={14} aria-hidden />
          <span>{t('dm.create.restored')}</span>
          <button
            type="button"
            className="mh-linkbtn"
            onClick={() => {
              clearDraft()
              setForm((f) => ({ ...EMPTY, domain: f.domain }))
              setRestored(false)
            }}
          >
            {t('dm.create.clearDraft')}
          </button>
        </p>
      )}
      {!configured && (
        <p className="mh-note mh-note--warn mh-note--box">
          <AlertCircle size={14} aria-hidden />
          <span>{t('dom.unconfigured')}</span>
        </p>
      )}
      <form id={`${id}-form`} onSubmit={submit} className="mh-form" noValidate>
        <div className="mh-field">
          <label className="mh-label" htmlFor={`${id}-name`}>
            {t('dom.add.localPart')}
          </label>
          <div className="mh-addrinput">
            <input
              id={`${id}-name`}
              data-autofocus
              value={form.name}
              onChange={set('name')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error && !form.name.trim() ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
              className="mh-input mh-input--mono"
            />
            <label className="mh-addrinput__at" htmlFor={`${id}-domain`}>
              <span className="sr-only">{t('dom.add.domain')}</span>
              <select id={`${id}-domain`} value={form.domain} onChange={set('domain')} className="mh-input mh-input--mono">
                {domains.length === 0 && <option value="">—</option>}
                {domains.map((d) => (
                  <option key={d} value={d}>
                    @{d}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="mh-form__two">
          <div className="mh-field">
            <label className="mh-label" htmlFor={`${id}-label`}>
              {t('dom.edit.label')}
            </label>
            <input id={`${id}-label`} value={form.label} onChange={set('label')} maxLength={200} placeholder={t('dom.add.label')} className="mh-input" />
          </div>
          <div className="mh-field">
            <label className="mh-label" htmlFor={`${id}-group`}>
              {t('dom.edit.group')}
            </label>
            <input id={`${id}-group`} value={form.group} onChange={set('group')} maxLength={100} className="mh-input" />
          </div>
        </div>
        {error && (
          <p id={`${id}-err`} role="alert" className="mh-formerr">
            <AlertCircle size={15} aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </form>
    </Modal>
  )
}

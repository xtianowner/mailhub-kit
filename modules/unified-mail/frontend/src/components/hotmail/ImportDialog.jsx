import { useEffect, useState } from 'react'
import { ChevronDown, Upload } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { useToast } from '../../lib/toast.jsx'
import { Modal } from '../Modal.jsx'

/* 导入账号（原来页面上的导入框，改成弹窗；导入逻辑、结果统计、错误列表都不变）。
   贴进来的文本含 refresh token 等凭据：只放在内存里，**不存草稿**（不写 sessionStorage / localStorage）。
   填了内容时点遮罩不会关、Esc / × / 取消先确认，由 Modal 统一处理。 */
export function ImportDialog({ open, onClose, onImported }) {
  const { t } = useLocale()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    if (!open) {
      setText('')
      setResult(null)
      setShowErrors(false)
    }
  }, [open])

  const onImport = async () => {
    if (!text.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const res = await api.importAccounts(text)
      setResult(res)
      if (res.errors?.length) setShowErrors(true)
      const acc = res.accounts_added ?? res.added ?? 0
      const ali = res.aliases_added ?? 0
      toast.success(`+${acc} ${t('overview.import.accountsAdded')}${ali ? ` · +${ali} ${t('overview.import.aliasesAdded')}` : ''}`)
      setText('')
      onImported?.()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('overview.import.title')}
      icon={Upload}
      description={t('hm.import.desc')}
      dirty={text.trim() !== ''}
      busy={busy}
      size="lg"
      footer={({ requestClose }) => (
        <span className="mh-modal__actions">
          <button type="button" className="mh-btn mh-btn--quiet" onClick={() => requestClose('cancel')} disabled={busy}>
            {result ? t('hm.import.done') : t('meta.cancel')}
          </button>
          <button type="button" className="mh-btn mh-btn--primary" onClick={onImport} disabled={busy || !text.trim()}>
            {busy && <span className="mh-btn__spin" aria-hidden />}
            {t('overview.import.btn')}
          </button>
        </span>
      )}
    >
      <label className="mh-field">
        <span className="mh-label">{t('hm.import.label')}</span>
        <textarea
          data-autofocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('overview.import.placeholder')}
          rows={7}
          spellCheck={false}
          autoComplete="off"
          className="mh-input mh-input--area mh-input--mono"
        />
        <span className="mh-help">{t('hm.import.help')}</span>
      </label>

      {result && (
        <div className="mh-import-result" role="status">
          <span>
            <b className="is-ok">+{result.accounts_added ?? result.added ?? 0}</b> {t('overview.import.accountsAdded')}
          </span>
          <span>
            <b>{result.accounts_existing ?? result.updated ?? 0}</b> {t('overview.import.accountsExisting')}
          </span>
          <span>
            <b className="is-ok">+{result.aliases_added ?? 0}</b> {t('overview.import.aliasesAdded')}
          </span>
          <span>
            <b>{result.skipped ?? 0}</b> {t('overview.import.skipped')}
          </span>
        </div>
      )}
      {result?.errors?.length > 0 && (
        <div className="mh-import-errors">
          <button type="button" className="mh-linkbtn mh-linkbtn--danger" onClick={() => setShowErrors((v) => !v)} aria-expanded={showErrors}>
            <ChevronDown size={14} className={showErrors ? '' : 'is-rot'} aria-hidden />
            {result.errors.length} {t('overview.import.errors')}
          </button>
          {showErrors && (
            <ul>
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}

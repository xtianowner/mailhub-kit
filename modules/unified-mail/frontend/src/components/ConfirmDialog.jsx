import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Modal } from './Modal.jsx'

/* 页面内的危险操作确认框（替代浏览器自带的 window.confirm）。外壳就是 Modal：
   看得见的 ×、Esc、焦点锁定与归还都由它负责；这里没有输入框，× / Esc / 点遮罩 / 「取消」都等于取消。
   默认焦点落在「取消」（误按回车不会删东西）；确认键用危险色，文案复述对象（地址等宽显示）和后果。

   用法（保持原来「问一句 → 继续原逻辑」的写法不变）：
     const [confirm, confirmDialog] = useConfirm()
     if (!(await confirm({ title, object, description, confirmLabel }))) return
     …原来的删除逻辑…
     return <>…{confirmDialog}</>  */
export function useConfirm() {
  const [request, setRequest] = useState(null) // { options }
  const pendingRef = useRef(null)
  // 关闭动画期间 request 已清空：沿用上一次的文案，避免框里的字先消失
  const lastRef = useRef(null)
  if (request) lastRef.current = request.options

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        pendingRef.current?.(false) // 上一个还没答复就来了新的：上一个按取消处理
        pendingRef.current = resolve
        setRequest({ options })
      }),
    [],
  )

  const settle = useCallback((ok) => {
    const resolve = pendingRef.current
    pendingRef.current = null
    setRequest(null)
    resolve?.(ok)
  }, [])

  // 页面卸载时还没答复：按取消处理
  useEffect(() => () => pendingRef.current?.(false), [])

  const options = lastRef.current || {}
  const dialog = (
    <ConfirmDialog
      open={Boolean(request)}
      title={options.title}
      object={options.object}
      description={options.description}
      confirmLabel={options.confirmLabel}
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  )
  return [confirm, dialog]
}

export function ConfirmDialog({ open, title, object, description, confirmLabel, onCancel, onConfirm }) {
  const { t } = useLocale()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      icon={Trash2}
      tone="danger"
      size="sm"
      footer={
        <span className="mh-modal__actions">
          <button type="button" className="mh-btn mh-btn--quiet" onClick={onCancel} data-autofocus>
            {t('meta.cancel')}
          </button>
          <button type="button" className="mh-btn mh-btn--danger" onClick={onConfirm}>
            <Trash2 size={15} aria-hidden />
            {confirmLabel}
          </button>
        </span>
      }
    >
      {object && <p className="mh-confirm__object">{object}</p>}
      {description && <p className="mh-confirm__desc">{description}</p>}
    </Modal>
  )
}

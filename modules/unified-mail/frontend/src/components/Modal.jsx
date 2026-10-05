import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { announce } from '../lib/announce.jsx'

/* 居中弹窗（新建信箱、导入账号等带输入的弹层）。基线 §7 的三件套 + 不吞数据的出口：
   ① 看得见的关闭按钮：右上角 ×，命中区 44px，悬停提示写明 Esc；
   ② Esc 关闭（中文输入法组字时不响应）；
   ③ 焦点锁定：打开时焦点移进弹窗，Tab / Shift+Tab 只在弹窗里循环，背后页面设 inert；关闭后焦点回到打开它的元素。
   补充：只让正文区滚动，标题和底部按钮常驻；打开期间锁住背后滚动并补上滚动条让出的宽度。
   不吞数据（dirty = 用户填了东西）：
     · 点遮罩 —— 没填东西直接关；填了东西不关，焦点移到 × 并提示「可点 × 或按 Esc 关闭」；
     · Esc / × / 取消 —— 填了东西先问一句，默认焦点在「继续编辑」；
     · 填了东西时刷新 / 关标签页由浏览器拦一下（beforeunload）。
   busy（提交中）时三条出口都暂停，避免请求发出去了界面却没了。
   footer 可以是函数 ({ requestClose }) => 节点：底部的「取消」走同一道守卫。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, icon: Icon, description, dirty = false, busy = false, children, footer, size = 'md' }) {
  const { t } = useLocale()
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const keepRef = useRef(null)
  const restoreRef = useRef(null)
  const [confirm, setConfirm] = useState(false)
  const [hint, setHint] = useState(false)
  const state = useRef({ dirty, busy, onClose, confirm })
  state.current = { dirty, busy, onClose, confirm }
  const titleId = useRef(`mh-modal-${Math.random().toString(36).slice(2, 8)}`).current

  const requestClose = useCallback(
    (from = 'button') => {
      const s = state.current
      if (s.busy) return
      if (!s.dirty) {
        s.onClose()
        return
      }
      if (from === 'scrim') {
        setHint(true)
        closeRef.current?.focus()
        announce(t('modal.dirtyHint'))
        return
      }
      setConfirm(true)
    },
    [t],
  )

  // 每次打开都从干净状态开始
  useEffect(() => {
    if (!open) {
      setConfirm(false)
      setHint(false)
    }
  }, [open])
  useEffect(() => {
    if (!dirty) {
      setConfirm(false)
      setHint(false)
    }
  }, [dirty])
  useEffect(() => {
    if (confirm) requestAnimationFrame(() => keepRef.current?.focus())
  }, [confirm])

  useEffect(() => {
    if (!open) return undefined
    restoreRef.current = document.activeElement
    const root = document.getElementById('root')
    const sbw = window.innerWidth - document.documentElement.clientWidth
    const prev = { overflow: document.body.style.overflow, pad: document.body.style.paddingRight }
    document.body.style.overflow = 'hidden'
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`
    root?.setAttribute('inert', '')
    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector('[data-autofocus]')
      ;(first || closeRef.current)?.focus()
    })

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return
        e.preventDefault()
        if (state.current.confirm) setConfirm(false)
        else requestClose('esc')
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = panelRef.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      root?.removeAttribute('inert')
      document.body.style.overflow = prev.overflow
      document.body.style.paddingRight = prev.pad
      const back = restoreRef.current
      if (back && document.contains(back)) requestAnimationFrame(() => back.focus({ preventScroll: true }))
    }
  }, [open, requestClose])

  // 填了东西时，刷新 / 关标签页先让浏览器问一句
  useEffect(() => {
    if (!open || !dirty) return undefined
    const onBefore = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [open, dirty])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="mh-modal-layer">
          <motion.div
            className="mh-modal-scrim"
            onClick={() => requestClose('scrim')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden
          />
          <motion.section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`mh-modal mh-modal--${size}`}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.9 }}
          >
            <header className="mh-modal__head">
              <div className="mh-modal__titles">
                <h2 id={titleId} className="mh-modal__title">
                  {Icon && <Icon size={17} aria-hidden />}
                  {title}
                </h2>
                {description && <p className="mh-modal__desc">{description}</p>}
              </div>
              <button
                ref={closeRef}
                type="button"
                className="mh-icon-btn mh-modal__close"
                onClick={() => requestClose('button')}
                disabled={busy}
                aria-label={t('drawer.close')}
                title={t('drawer.closeHint')}
              >
                <X size={18} />
              </button>
            </header>

            <div className="mh-modal__body">
              {hint && dirty && !confirm && (
                <p className="mh-modal__hint" role="status">
                  <AlertTriangle size={14} aria-hidden />
                  <span>{t('modal.dirtyHint')}</span>
                </p>
              )}
              {children}
            </div>

            <footer className="mh-modal__foot">
              {confirm ? (
                <div className="mh-modal__confirm" role="alertdialog" aria-label={t('modal.discardTitle')}>
                  <span className="mh-modal__confirm-text">
                    <AlertTriangle size={15} aria-hidden />
                    {t('modal.discardTitle')}
                  </span>
                  <span className="mh-modal__actions">
                    <button ref={keepRef} type="button" className="mh-btn mh-btn--primary mh-btn--sm" onClick={() => setConfirm(false)}>
                      {t('modal.keepEditing')}
                    </button>
                    <button type="button" className="mh-btn mh-btn--danger mh-btn--sm" onClick={() => state.current.onClose()}>
                      {t('modal.discard')}
                    </button>
                  </span>
                </div>
              ) : typeof footer === 'function' ? (
                footer({ requestClose })
              ) : (
                footer
              )}
            </footer>
          </motion.section>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

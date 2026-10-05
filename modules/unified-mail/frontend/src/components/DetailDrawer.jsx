import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, Maximize, Minimize, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'

/* 右侧详情抽屉（邮件、账号详情共用）。弹层三件套 + 两条补充：
   ① 看得见的关闭按钮（右上角 ×，命中区 ≥ 44px，悬停提示写明 Esc）；
   ② Esc 关闭（中文输入法组字时不响应）；
   ③ 焦点锁定：打开时焦点移进抽屉，Tab / Shift+Tab 只在抽屉里循环，背后页面设 inert；
   补充：关闭后焦点回到打开它的那个元素；打开期间锁住背后页面滚动，并补上滚动条让出的宽度，页面不左右跳。
   抽屉里没有输入框，点遮罩直接关闭不会丢东西。挂到 body 上（portal），不受页面转场的 transform 影响。
   只做头 / 正文两段：正文自己滚，标题和关闭按钮常驻可见。

   可选能力（调用方按需打开，默认都关）：
   - resizeKey：左边缘拖拽手柄调宽（420px ~ 视口 90%），宽度按 key 记在 localStorage；
     手柄可聚焦，左右方向键调宽（Shift 加大步长），Home / End 到最窄 / 最宽。窄屏（≤ 640px）抽屉本来就占满，不显示手柄。
   - allowFullscreen：顶部「全屏」按钮，抽屉铺满视口，再点还原。Esc 两段式：先退出全屏，再按一次才关闭。
   - externalHref：顶部「在新页面打开」，新标签页打开独立详情页。 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

const DEFAULT_WIDTH = 580
const MIN_WIDTH = 420
const MAX_RATIO = 0.9
const STEP = 16
const STEP_BIG = 64
const storageKey = (k) => `mh.drawer.width.${k}`

function readWidth(key) {
  if (!key) return DEFAULT_WIDTH
  try {
    const v = Number(localStorage.getItem(storageKey(key)))
    return Number.isFinite(v) && v >= MIN_WIDTH ? v : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}
function writeWidth(key, w) {
  try {
    localStorage.setItem(storageKey(key), String(Math.round(w)))
  } catch {
    /* 隐私模式等写不进就算了，本次会话里照样生效 */
  }
}
const maxWidth = () => Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_RATIO))
const clampWidth = (w) => Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()))

export function DetailDrawer({
  open,
  onClose,
  title,
  titleId = 'mh-drawer-title',
  resizeKey,
  allowFullscreen = false,
  externalHref,
  children,
}) {
  const { t } = useLocale()
  const layerRef = useRef(null)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const restoreRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const resizable = Boolean(resizeKey)
  const [width, setWidth] = useState(() => readWidth(resizeKey))
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  const [dragging, setDragging] = useState(false)
  const [full, setFull] = useState(false)
  const fullRef = useRef(full)
  fullRef.current = full

  // 每次打开都从「非全屏」开始
  useEffect(() => {
    if (!open) setFull(false)
  }, [open])

  // 视口变化时，手柄的取值范围跟着变（实际宽度由 CSS 的 90vw 上限兜住）
  useEffect(() => {
    if (!open || !resizable) return undefined
    const onResize = () => setViewport(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, resizable])

  const commitWidth = useCallback(
    (w) => {
      const next = clampWidth(w)
      setWidth(next)
      writeWidth(resizeKey, next)
    },
    [resizeKey],
  )

  useEffect(() => {
    if (!open) return undefined
    restoreRef.current = document.activeElement
    const root = document.getElementById('root')
    const sbw = window.innerWidth - document.documentElement.clientWidth
    const prev = { overflow: document.body.style.overflow, pad: document.body.style.paddingRight }
    document.body.style.overflow = 'hidden'
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`
    root?.setAttribute('inert', '')
    const raf = requestAnimationFrame(() => closeRef.current?.focus())

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return
        e.preventDefault()
        // 两段式：全屏时先退出全屏，再按一次才关闭
        if (fullRef.current) setFull(false)
        else onCloseRef.current?.()
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
      // 触发元素可能已被轮询重渲染替换：还在文档里才还焦点
      if (back && document.contains(back)) requestAnimationFrame(() => back.focus({ preventScroll: true }))
    }
  }, [open])

  /* 拖拽调宽：拖动过程中直接改 CSS 变量（不重渲染抽屉内容），松手再写进状态与 localStorage。
     指针捕获在手柄上；拖动期间抽屉里的 iframe 不接指针事件，划过邮件正文也不会丢失拖拽。 */
  const onHandleDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const layer = layerRef.current
    const startX = e.clientX
    const startW = panelRef.current?.getBoundingClientRect().width || width
    let w = startW
    handle.setPointerCapture?.(e.pointerId)
    setDragging(true)
    const move = (ev) => {
      w = clampWidth(startW + (startX - ev.clientX))
      layer?.style.setProperty('--mh-drawer-w', `${w}px`)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setDragging(false)
      commitWidth(w)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onHandleKey = (e) => {
    const cur = clampWidth(width)
    let next = null
    if (e.key === 'ArrowLeft') next = cur + (e.shiftKey ? STEP_BIG : STEP)
    else if (e.key === 'ArrowRight') next = cur - (e.shiftKey ? STEP_BIG : STEP)
    else if (e.key === 'Home') next = MIN_WIDTH
    else if (e.key === 'End') next = maxWidth()
    if (next === null) return
    e.preventDefault()
    commitWidth(next)
  }

  const shownWidth = Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, Math.floor(viewport * MAX_RATIO)))
  const layerStyle = resizable ? { '--mh-drawer-w': `${shownWidth}px` } : undefined
  const panelClass = ['mh-drawer', resizable && 'is-resizable', full && 'is-full', dragging && 'is-resizing']
    .filter(Boolean)
    .join(' ')

  return createPortal(
    <AnimatePresence>
      {open && (
        <div ref={layerRef} className="mh-drawer-layer" style={layerStyle}>
          <motion.div
            className="mh-drawer-scrim"
            onClick={() => onCloseRef.current?.()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={panelClass}
            initial={{ x: '100%', opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.6, transition: { duration: 0.22, ease: [0.7, 0, 0.84, 0] } }}
            transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
          >
            {resizable && !full && (
              <div
                className="mh-drawer__grip"
                role="separator"
                aria-orientation="vertical"
                aria-label={t('drawer.resize')}
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={Math.max(MIN_WIDTH, Math.floor(viewport * MAX_RATIO))}
                aria-valuenow={shownWidth}
                aria-valuetext={t('drawer.resize.value', { n: shownWidth })}
                title={t('drawer.resize.hint')}
                tabIndex={0}
                onPointerDown={onHandleDown}
                onKeyDown={onHandleKey}
              />
            )}
            <header className="mh-drawer__head">
              <h2 id={titleId} className="mh-drawer__title">
                {title}
              </h2>
              {allowFullscreen && (
                <button
                  type="button"
                  className={`mh-icon-btn mh-drawer__fs${full ? ' is-on' : ''}`}
                  onClick={() => setFull((v) => !v)}
                  aria-pressed={full}
                  aria-label={t(full ? 'drawer.full.exit' : 'drawer.full')}
                  title={t(full ? 'drawer.full.exitHint' : 'drawer.full.hint')}
                >
                  {full ? <Minimize size={17} aria-hidden /> : <Maximize size={17} aria-hidden />}
                </button>
              )}
              {externalHref && (
                <a
                  className="mh-icon-btn"
                  href={externalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('drawer.openNew')}
                  title={t('drawer.openNew.hint')}
                >
                  <ExternalLink size={17} aria-hidden />
                </a>
              )}
              <button
                ref={closeRef}
                type="button"
                className="mh-icon-btn mh-drawer__close"
                onClick={() => onCloseRef.current?.()}
                aria-label={t('drawer.close')}
                title={t('drawer.closeHint')}
              >
                <X size={18} />
              </button>
            </header>
            <div className="mh-drawer__body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

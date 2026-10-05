import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, AlertCircle, Info } from 'lucide-react'

// Minimal global toast (success/error/info). z-toast layer，顶部居中，约 3 秒自动消失，点一下即关闭（基线 §7）。
const ToastContext = createContext(null)

let _id = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const tm = timers.current.get(id)
    if (tm) {
      clearTimeout(tm)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message, tone = 'success', ttl = 3000) => {
      const id = ++_id
      setToasts((list) => [...list, { id, message, tone }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ttl),
      )
      return id
    },
    [dismiss],
  )

  const value = {
    push,
    success: (m, ttl) => push(m, 'success', ttl),
    error: (m, ttl) => push(m, 'danger', ttl ?? 3000),
    info: (m, ttl) => push(m, 'info', ttl),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed left-1/2 top-4 z-toast flex w-[min(92vw,360px)] -translate-x-1/2 flex-col items-center gap-2"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <Toast key={t.id} {...t} onClick={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

const TONE_ICON = { success: Check, danger: AlertCircle, info: Info }
const TONE_RING = {
  success: 'text-success',
  danger: 'text-danger',
  info: 'text-muted',
}

function Toast({ message, tone, onClick }) {
  const Icon = TONE_ICON[tone] || Info
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}
      onClick={onClick}
      className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-text shadow-lift"
    >
      <Icon size={16} className={`shrink-0 ${TONE_RING[tone] || ''}`} />
      <span className="truncate">{message}</span>
    </motion.div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

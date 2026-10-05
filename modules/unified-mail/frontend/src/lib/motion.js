// 动效与交互的小工具（统一总览、登录页、外壳共用）。motion 管不到的地方（Canvas、rAF、计数）都靠这里兜底 reduced-motion。
import { useCallback, useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

export const EASE = [0.22, 1, 0.36, 1] // = tokens.css --ease

/** 允许动效？——系统「减少动态效果」优先 */
export function useMotionOK() {
  return !useReducedMotion()
}

/** 每 interval 毫秒刷新一次「现在」，给相对时间用；标签页隐藏时不刷 */
export function useNow(interval = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }, interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}

/** 数字滚动：直接写 textContent，不触发 React 重渲染；减少动态效果时直接跳到终值 */
export function useCountUp(value, { duration = 1.1, format = (n) => String(n) } = {}) {
  const ref = useRef(null)
  const from = useRef(0)
  const motionOK = useMotionOK()
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (!motionOK || !Number.isFinite(value)) {
      el.textContent = Number.isFinite(value) ? format(value) : '—'
      from.current = Number.isFinite(value) ? value : 0
      return undefined
    }
    const controls = animate(from.current, value, {
      duration: from.current === 0 ? duration : 0.6,
      ease: EASE,
      onUpdate: (v) => {
        el.textContent = format(Math.round(v))
      },
    })
    from.current = value
    return () => controls.stop()
    // format 由调用方保证稳定；不放进依赖，免得每次渲染都重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, motionOK, duration])
  return ref
}

/** ⌘K / Ctrl+K 聚焦搜索框 */
export function useCmdK(inputRef, onFocus) {
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        onFocus?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputRef, onFocus])
}

/** 复制到剪贴板：优先异步 Clipboard API（点击当帧就发起），不行退回隐藏 textarea */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 退回下面的兜底 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 记在 localStorage 里的布尔值（信息区折叠状态等） */
export function useStoredBool(key, initial = false) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key)
      return s === null ? initial : s === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next) => {
      setV((prev) => {
        const val = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(key, val ? '1' : '0')
        } catch {
          /* 隐私模式 */
        }
        return val
      })
    },
    [key],
  )
  return [v, set]
}

/** 页面是否已向下滚动（顶栏据此加阴影） */
export function useScrolled(threshold = 4) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [threshold])
  return scrolled
}

/** 鼠标位置写进 CSS 变量 --mx / --my，给悬停聚光用（不触发 React 渲染） */
export function spotlight(e) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}

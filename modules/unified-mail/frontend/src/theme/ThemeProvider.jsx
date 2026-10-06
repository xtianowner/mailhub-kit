import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'

// 主题切换：给 <html> 设 data-theme，tokens.css 的 [data-theme="light"] 即生效。
// 三种来源，优先级从高到低：
//   1. 链接里的 ?theme=dark|light —— 只对这次打开生效（不写进浏览器存储），也不跟随系统；
//   2. 用户手动切换过 —— 记在 localStorage 的 mh.theme.manual，之后一直用它；
//   3. 都没有 —— 跟随系统深浅色，系统切换时实时跟着变；这种情况下不往存储里写任何东西。
// 旧版本存的 `theme` 键不再读取：没手动切换过的访客一律按「跟随系统」处理。
// index.html 里的 pre-paint 脚本按同样的规则在首屏前定主题，避免闪烁。
const ThemeContext = createContext(null)

export const MANUAL_THEME_KEY = 'mh.theme.manual'
const SYSTEM_LIGHT = '(prefers-color-scheme: light)'
const isTheme = (v) => v === 'light' || v === 'dark'

function systemTheme() {
  try {
    return window.matchMedia(SYSTEM_LIGHT).matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function initialState() {
  if (typeof window === 'undefined') return { theme: 'dark', mode: 'system' }
  try {
    const forced = new URLSearchParams(window.location.search).get('theme')
    if (isTheme(forced)) return { theme: forced, mode: 'forced' }
  } catch {
    /* ignore */
  }
  try {
    const manual = localStorage.getItem(MANUAL_THEME_KEY)
    if (isTheme(manual)) return { theme: manual, mode: 'manual' }
  } catch {
    /* 隐私模式等读不到存储：按跟随系统处理 */
  }
  return { theme: systemTheme(), mode: 'system' }
}

export function ThemeProvider({ children }) {
  const [state, setState] = useState(initialState)
  const { theme, mode } = state

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 跟随系统：监听系统深浅色变化（手动选过或链接强制时不监听）
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(SYSTEM_LIGHT)
    const sync = () => setState((s) => (s.mode === 'system' ? { ...s, theme: mq.matches ? 'light' : 'dark' } : s))
    sync()
    if (mq.addEventListener) mq.addEventListener('change', sync)
    else mq.addListener?.(sync)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', sync)
      else mq.removeListener?.(sync)
    }
  }, [mode])

  // 手动选择：从此记住，不再跟随系统
  const choose = useCallback((next) => {
    if (!isTheme(next)) return
    setState({ theme: next, mode: 'manual' })
    try {
      localStorage.setItem(MANUAL_THEME_KEY, next)
    } catch {
      /* 写不进存储：本次会话里照样生效 */
    }
  }, [])
  const setTheme = choose
  const toggle = useCallback(() => choose(theme === 'dark' ? 'light' : 'dark'), [choose, theme])
  const value = useMemo(() => ({ theme, mode, setTheme, toggle }), [theme, mode, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

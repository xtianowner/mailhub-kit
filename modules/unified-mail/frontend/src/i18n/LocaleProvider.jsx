import { createContext, useContext, useMemo, useState, useCallback } from 'react'
import { messages } from './messages.js'

const LocaleContext = createContext(null)

// 当前语言的模块级镜像：给拿不到 hook 的数据层（错误提示、兜底文案）用，见 translate()。
let activeLocale = 'zh'

function format(locale, key, vars) {
  let str = messages[locale]?.[key] ?? key
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]))
    }
  }
  return str
}

// 单复数：按 Intl.PluralRules 选 `${key}.one` / `${key}.other`，缺哪个就退回 other。
// 中文只有 other 一种形态，英文 1 → one（「1 domain」），其余 → other（「2 domains」）。
const pluralRules = {}
function pluralKey(locale, key, n) {
  const tag = locale === 'zh' ? 'zh-CN' : 'en'
  pluralRules[tag] ||= new Intl.PluralRules(tag)
  const exact = `${key}.${pluralRules[tag].select(Number(n))}`
  return messages[locale]?.[exact] !== undefined ? exact : `${key}.other`
}

/** 组件外取文案（数据层的错误提示等）。取的是调用那一刻的界面语言。 */
export function translate(key, vars) {
  return format(activeLocale, key, vars)
}

export function LocaleProvider({ children, defaultLocale = 'zh' }) {
  const [locale, setLocale] = useState(defaultLocale)
  activeLocale = locale
  const toggle = useCallback(() => setLocale((l) => (l === 'zh' ? 'en' : 'zh')), [])
  // t(key, vars?) — vars 用于 {name} 占位插值，如 t('page.of', { page, pages })
  const t = useCallback((key, vars) => format(locale, key, vars), [locale])
  // tn(key, n, vars?) — 带数量的文案，按语言选单复数形态；{n} 自动插值
  const tn = useCallback(
    (key, n, vars) => format(locale, pluralKey(locale, key, n), { n, ...vars }),
    [locale],
  )
  const value = useMemo(() => ({ locale, setLocale, toggle, t, tn }), [locale, toggle, t, tn])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

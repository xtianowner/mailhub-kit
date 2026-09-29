import { createContext, useContext, useMemo, useState, useCallback } from 'react'
import { messages } from './messages.js'

const LocaleContext = createContext(null)

export function LocaleProvider({ children, defaultLocale = 'zh' }) {
  const [locale, setLocale] = useState(defaultLocale)
  const toggle = useCallback(() => setLocale((l) => (l === 'zh' ? 'en' : 'zh')), [])
  // t(key, vars?) — vars 用于 {name} 占位插值，如 t('page.of', { page, pages })
  const t = useCallback(
    (key, vars) => {
      let str = messages[locale]?.[key] ?? key
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]))
        }
      }
      return str
    },
    [locale],
  )
  const value = useMemo(() => ({ locale, setLocale, toggle, t }), [locale, toggle, t])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

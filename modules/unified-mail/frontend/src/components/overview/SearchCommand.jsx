import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useCmdK } from '../../lib/motion.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** 命令面板式搜索（统一总览；Hotmail 账号、域名邮箱页用 compact 版，传自己的占位文字）：磨砂底、⌘K / Ctrl+K 聚焦（聚焦时一圈光晕）、停止输入 350ms 后生效、回车立即生效、Esc 清空。
 *  value 是已生效的关键词（落在 URL 上），输入框自己持有正在打的字。 */
export function SearchCommand({ value, onSearch, resultHint, placeholder, label, compact = false }) {
  const { t } = useLocale()
  const ref = useRef(null)
  const [text, setText] = useState(value)
  const [flash, setFlash] = useState(0)
  const timer = useRef(0)
  const onCmdK = useCallback(() => setFlash((n) => n + 1), [])
  useCmdK(ref, onCmdK)

  // 外部改了关键词（清除筛选、浏览器后退）时同步进输入框
  useEffect(() => {
    setText(value)
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (q) => {
    clearTimeout(timer.current)
    if (q.trim() !== value) onSearch(q.trim())
  }
  const onChange = (e) => {
    const q = e.target.value
    setText(q)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(q), 350)
  }

  return (
    <form
      role="search"
      className={`mh-search ${compact ? 'mh-search--compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        commit(text)
      }}
    >
      {flash > 0 && <span key={flash} className="mh-search__flash" aria-hidden />}
      <Search size={18} className="mh-search__icon" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={text}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault()
            setText('')
            commit('')
          }
        }}
        placeholder={placeholder || t('ov.search.placeholder')}
        aria-label={label || t('ov.search.label')}
        aria-describedby={resultHint ? 'mh-search-hint' : undefined}
        className="mh-search__input"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {text && (
        <button
          type="button"
          className="mh-search__clear"
          onClick={() => {
            setText('')
            commit('')
            ref.current?.focus()
          }}
          aria-label={t('ov.search.clear')}
          title={t('ov.search.clear')}
        >
          <X size={16} />
        </button>
      )}
      <kbd className="mh-search__kbd" title={t(isMac ? 'ov.search.kbdMac' : 'ov.search.kbd')}>
        {isMac ? '⌘' : 'Ctrl'}
        <span>K</span>
      </kbd>
      {resultHint && (
        <span id="mh-search-hint" className="sr-only">
          {resultHint}
        </span>
      )}
    </form>
  )
}

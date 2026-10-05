import { useEffect, useId, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'

export const PAGE_SIZE_OPTIONS = [50, 100, 200]

// 放在长表上方的翻页条（别名页在用），翻页不用滚到底。行为与改版前相同：
// 总数 / 每页条数 / 跳页（回车或失焦生效）/ 上一页、下一页。
//   data: { page, pages, total }；onPage(p)：翻到第 p 页（从 1 开始，调用方负责回到顶部）
//   pageSize, onPageSize(n)；slot：左侧额外的控件
export function Pager({ data, onPage, pageSize, onPageSize, slot }) {
  const { t } = useLocale()
  const id = useId()
  const page = data?.page || 1
  const pages = Math.max(1, data?.pages || 1)
  const total = data?.total ?? 0

  const [jump, setJump] = useState(String(page))
  useEffect(() => {
    setJump(String(page))
  }, [page])

  const commitJump = () => {
    const n = parseInt(jump, 10)
    if (!Number.isFinite(n)) {
      setJump(String(page))
      return
    }
    const clamped = Math.min(Math.max(1, n), pages)
    setJump(String(clamped))
    if (clamped !== page) onPage(clamped)
  }

  return (
    <div className="mh-pager">
      <div className="mh-pager__info">
        <span>{t('page.total', { total })}</span>
        {slot}
      </div>
      <div className="mh-pager__ctrls">
        <label className="mh-pager__field" htmlFor={`${id}-size`}>
          <span className="mh-pager__lbl">{t('page.perPage')}</span>
          <select id={`${id}-size`} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="mh-input mh-input--sm">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="mh-pager__field" htmlFor={`${id}-jump`}>
          <span className="mh-pager__lbl">{t('page.jump')}</span>
          <input
            id={`${id}-jump`}
            type="number"
            min={1}
            max={pages}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitJump()
              }
            }}
            onBlur={commitJump}
            className="mh-input mh-input--sm mh-input--jump"
          />
          <span className="mh-pager__of">/ {pages}</span>
        </label>
        <span className="mh-pager__nav">
          <button type="button" className="mh-act mh-act--label" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('page.prev')} title={t('page.prev')}>
            <ChevronLeft size={14} aria-hidden />
            <span className="mh-pager__navtext">{t('page.prev')}</span>
          </button>
          <span className="mh-pager__page">{t('page.of', { page, pages })}</span>
          <button type="button" className="mh-act mh-act--label" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('page.next')} title={t('page.next')}>
            <span className="mh-pager__navtext">{t('page.next')}</span>
            <ChevronRight size={14} aria-hidden />
          </button>
        </span>
      </div>
    </div>
  )
}

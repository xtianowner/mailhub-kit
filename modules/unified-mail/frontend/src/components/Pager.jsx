import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './ui.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'

export const PAGE_SIZE_OPTIONS = [50, 100, 200]

// Reachable pager toolbar — meant to sit ABOVE a long table so paging never
// requires scrolling to the bottom. Shows total / N-of-M, prev/next, a jump-to
// input (enter to go), and a page-size select. Used by Accounts + Aliases.
//
// Props:
//   data: { page, pages, total }  — current paging state from the API
//   onPage(p)          — navigate to page p (1-based; caller scrolls to top)
//   pageSize, onPageSize(n)  — current size + change handler
//   slot               — optional extra controls rendered on the left (e.g. sort)
export function Pager({ data, onPage, pageSize, onPageSize, slot }) {
  const { t } = useLocale()
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
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs text-subtle">{t('page.total', { total })}</span>
        {slot}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* page size */}
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span className="hidden sm:inline">{t('page.perPage')}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-8 cursor-pointer rounded border border-border bg-surface-2/60 px-2 text-xs text-text focus:border-accent focus:outline-none"
            aria-label={t('page.perPage')}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {/* jump to page */}
        <div className="flex items-center gap-1 text-xs text-muted">
          <span className="hidden sm:inline">{t('page.jump')}</span>
          <input
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
            aria-label={t('page.jump')}
            className="h-8 w-14 rounded border border-border bg-surface-2/60 px-2 text-center text-xs tabular-nums text-text focus:border-accent focus:outline-none"
          />
          <span className="tabular-nums text-subtle">/ {pages}</span>
        </div>

        {/* prev / next */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="subtle" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={14} />
            <span className="hidden md:inline">{t('page.prev')}</span>
          </Button>
          <span className="px-1 text-xs tabular-nums text-muted">{t('page.of', { page, pages })}</span>
          <Button
            size="sm"
            variant="subtle"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            <span className="hidden md:inline">{t('page.next')}</span>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}

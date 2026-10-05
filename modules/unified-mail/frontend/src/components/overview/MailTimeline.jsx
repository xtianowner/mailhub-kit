import { memo, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { EASE, useMotionOK } from '../../lib/motion.js'
import { fmtDateTime, fmtRelative } from '../../lib/format.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { EmptyState } from '../EmptyState.jsx'
import { EnvelopeSkeleton } from '../EnvelopeSkeleton.jsx'
import { CodeChip } from './CodeChip.jsx'
import { Hl } from './Hl.jsx'
import { segKeyDown } from './segKeys.js'

export const LIMITS = [10, 20, 50, 100]

// 已经播过「到达动画」的邮件：筛选来回切换、重新挂载时不再重播
const played = new Set()

/** 信封：落下 → 掀开封口 → 化开成一行（只在允许动效时出现） */
function Envelope() {
  return (
    <motion.span
      className="mh-env"
      aria-hidden
      initial={{ y: -46, opacity: 0, scale: 0.9 }}
      animate={{ y: [-46, 0, 0, -4], opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 1.35] }}
      transition={{ duration: 1.05, times: [0, 0.38, 0.68, 1], ease: EASE }}
    >
      <span className="mh-env__body" />
      <motion.span
        className="mh-env__flap"
        initial={{ rotateX: 0 }}
        animate={{ rotateX: [0, 0, 180] }}
        transition={{ duration: 0.75, times: [0, 0.55, 1], ease: EASE }}
      />
      <span className="mh-env__seal" />
    </motion.span>
  )
}

/* 单行：memo 包裹，只在自己的数据（行对象引用）、搜索词、相对时间或语言变化时重渲染。
   轮询拿到新邮件时，旧行对象原样复用，所以只有新行会渲染。 */
const MailRow = memo(
  function MailRow({ m, index, q, rel, showSource, onOpen, motionOK }) {
    const { t } = useLocale()
    const arriving = motionOK && m._arrival && !played.has(m._key)
    useEffect(() => {
      if (!arriving) return undefined
      const id = setTimeout(() => played.add(m._key), 2600)
      return () => clearTimeout(id)
    }, [arriving, m._key])
    const srcLabel = t(m.source === 'hotmail' ? 'src.hotmail' : 'src.domain')
    const from = m.from_name || m.from_address || ''

    return (
      <motion.li
        layout="position"
        className={`mh-row mh-row--${m.source} ${arriving || (m._arrival && !motionOK) ? 'is-arrival' : ''}`}
        // 到达的新行：行位立刻出现（下面的行靠 layout 动画平滑让位），信封落进空位后，
        // 行内容再由 CSS（.is-arrival > *）淡入。行本身不能从透明开始，否则作为子元素的信封也看不见。
        initial={arriving ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.16 } }}
        transition={{ duration: 0.28, ease: EASE, delay: Math.min(index * 0.012, 0.12) }}
        data-key={m._key}
      >
        {arriving && <Envelope />}
        <span className={`mh-dot mh-dot--${m.source} mh-row__dot`} title={showSource ? srcLabel : undefined}>
          {showSource && <span className="sr-only">{srcLabel}</span>}
        </span>
        <span className="mh-row__main">
          <button type="button" className="mh-row__open" onClick={() => onOpen(m)} aria-haspopup="dialog">
            <span className="mh-row__subject">
              {m.subject ? <Hl text={m.subject} q={q} /> : <span className="mh-row__nosubj">{t('common.noSubject')}</span>}
            </span>
          </button>
          {from && (
            <span className="mh-row__meta">
              <span className="mh-row__from" title={m.from_address || ''}>
                <Hl text={from} q={q} />
              </span>
            </span>
          )}
        </span>
        <span className="mh-row__to" title={m.mailbox}>
          <Hl text={m.mailbox} q={q} />
        </span>
        <span className="mh-row__code">{m.code && <CodeChip code={m.code} query={q} size="sm" />}</span>
        <time className="mh-row__time" dateTime={m.received_at || undefined} title={fmtDateTime(m.received_at) || ''}>
          {rel}
        </time>
      </motion.li>
    )
  },
  // index 只用于首次入场的错峰；新邮件插到顶部时其余行的 index 会变，但不该因此重渲染
  (a, b) =>
    a.m === b.m &&
    a.q === b.q &&
    a.rel === b.rel &&
    a.showSource === b.showSource &&
    a.onOpen === b.onOpen &&
    a.motionOK === b.motionOK,
)

// 行悬停聚光：鼠标位置写进那一行的 CSS 变量（不触发 React 渲染）
const rowSpot = (e) => {
  const row = e.target.closest?.('.mh-row')
  if (!row) return
  const r = row.getBoundingClientRect()
  row.style.setProperty('--mx', `${e.clientX - r.left}px`)
  row.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export function CountSwitch({ value, onChange }) {
  const { t } = useLocale()
  return (
    <div
      className="mh-seg mh-seg--sm"
      role="radiogroup"
      aria-label={t('ov.limit.label')}
      onKeyDown={(e) => segKeyDown(e, LIMITS, value, onChange)}
    >
      {LIMITS.map((n) => {
        const on = value === n
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`mh-seg__btn ${on ? 'is-on' : ''}`}
            onClick={() => onChange(n)}
          >
            {on && (
              <motion.span
                layoutId="mh-limit-pill"
                className="mh-seg__pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="mh-seg__label">{n}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 最近邮件：一条混合时间线（Hotmail 与域名邮箱按收信时间混排），右上角选 10 / 20 / 50 / 100 封，不翻页 */
export function MailTimeline({
  rows,
  state,
  limit,
  onLimit,
  query,
  filtersActive,
  onReset,
  onOpen,
  onRetry,
  showSource,
  now,
  emptyMessage,
}) {
  const { t, locale } = useLocale()
  const motionOK = useMotionOK()
  const shown = rows.length
  const searching = query.trim() !== ''

  let body
  if (state === 'loading') {
    body = <EnvelopeSkeleton rows={Math.min(limit, 6)} label={t('common.loading')} />
  } else if (state === 'error' && shown === 0) {
    body = (
      <EmptyState
        pose="search"
        tone="danger"
        icon={AlertTriangle}
        title={t('ov.timeline.errorTitle')}
        desc={t('ov.timeline.errorDesc')}
        action={
          <button type="button" className="mh-btn mh-btn--ghost" onClick={onRetry}>
            <RotateCcw size={14} aria-hidden />
            {t('common.retry')}
          </button>
        }
      />
    )
  } else if (shown === 0) {
    body = filtersActive ? (
      <EmptyState
        pose="search"
        title={t('hub.timeline.emptyFiltered')}
        desc={t('ov.timeline.emptyFilteredDesc')}
        action={
          <button type="button" className="mh-btn mh-btn--ghost" onClick={onReset}>
            <RotateCcw size={14} aria-hidden />
            {t('ov.filter.resetAll')}
          </button>
        }
      />
    ) : (
      <EmptyState pose="wait" title={t('ov.timeline.emptyTitle')} desc={emptyMessage} />
    )
  } else {
    body = (
      <ol
        className={`mh-list ${state === 'refreshing' ? 'is-busy' : ''}`}
        aria-busy={state === 'refreshing' || undefined}
        onMouseMove={rowSpot}
      >
        <AnimatePresence mode="popLayout" initial>
          {rows.map((m, i) => (
            <MailRow
              key={m._key}
              m={m}
              index={i}
              q={query}
              rel={fmtRelative(m.received_at, locale, now) || ''}
              showSource={showSource}
              onOpen={onOpen}
              motionOK={motionOK}
            />
          ))}
        </AnimatePresence>
      </ol>
    )
  }

  return (
    <section className="mh-card mh-timeline" aria-labelledby="mh-tl-title">
      <header className="mh-timeline__head">
        <div className="mh-timeline__titles">
          <h2 id="mh-tl-title" className="mh-h2">
            {searching ? t('ov.timeline.searchTitle') : t('hub.timeline.title')}
          </h2>
          <p className="mh-timeline__sub">
            {showSource && (
              <>
                <span className="mh-legend">
                  <span className="mh-dot mh-dot--hotmail" aria-hidden /> {t('src.hotmail')}
                </span>
                <span className="mh-legend">
                  <span className="mh-dot mh-dot--domain" aria-hidden /> {t('src.domain')}
                </span>
              </>
            )}
            <span className="mh-timeline__note">{t(showSource ? 'ov.timeline.noteMixed' : 'ov.timeline.note')}</span>
          </p>
        </div>
        <CountSwitch value={limit} onChange={onLimit} />
      </header>

      {shown > 0 && state !== 'loading' && (
        <div className="mh-cols" aria-hidden>
          <span />
          <span>{t('inbox.col.subject')}</span>
          <span>{t('inbox.col.mailbox')}</span>
          <span>{t('inbox.col.code')}</span>
          <span className="mh-cols__time">{t('inbox.col.received')}</span>
        </div>
      )}

      {body}

      {state === 'error' && shown > 0 && (
        <p className="mh-timeline__warn" role="status">
          <AlertTriangle size={14} aria-hidden />
          {t('ov.timeline.refreshFailed')}
          <button type="button" className="mh-linkbtn" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </p>
      )}

      {shown > 0 && state !== 'loading' && (
        <footer className="mh-timeline__foot">
          {shown >= limit
            ? t('ov.timeline.footLimit', { n: shown })
            : t(filtersActive ? 'ov.timeline.footAllFiltered' : 'ov.timeline.footAll', { n: shown })}
        </footer>
      )}
    </section>
  )
}

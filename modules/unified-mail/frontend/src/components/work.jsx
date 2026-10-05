import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, ChevronDown, Copy, FolderTree, Loader2 } from 'lucide-react'
import { useCopy } from '../lib/useCopy.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { CodeChip } from './overview/CodeChip.jsx'
import { Hl } from './overview/Hl.jsx'
import { segKeyDown } from './overview/segKeys.js'

/* 干活层（Hotmail 账号、域名邮箱、设置、详情）共用的小件。样式在 styles/work.css，类名 mh- 前缀。
   这些页面只做快速微交互：悬停聚光、复制反馈、分段胶囊滑块；不放展示层的大动画。 */

/* ── 状态胶囊 ───────────────────────────────────────────────
   tone：ok 正常 / warn 快过期 / bad 已过期·失效 / muted 未刷新·中性 / info 次要来源。
   胶囊自带不透明底色，压在悬停聚光的行上时文字对比度不变。 */
export function StatusPill({ tone = 'muted', children, title, className = '', dot = true }) {
  return (
    <span className={`mh-pill mh-pill--${tone} ${className}`} title={title}>
      {dot && <span className="mh-pill__dot" aria-hidden />}
      {children}
    </span>
  )
}

const BUCKET_PILL = { ok: 'ok', expiring: 'warn', expired: 'bad', dead: 'bad', never: 'muted' }
export const bucketToneOf = (bucket) => BUCKET_PILL[bucket] || 'muted'

/** Hotmail 账号的状态胶囊：失效优先，其次按 RT 有效期分桶；有剩余天数时跟一个小字 */
export function AccountStatus({ acc, title }) {
  const { t } = useLocale()
  const bucket = acc.status === 'dead' ? 'dead' : acc.bucket || 'never'
  const days = acc.rt_days_left
  return (
    <span className="mh-astatus" title={title}>
      <StatusPill tone={bucketToneOf(bucket)}>{t(`bucket.${bucket}`)}</StatusPill>
      {bucket !== 'dead' && days !== null && days !== undefined && days >= 0 && (
        <span className="mh-astatus__days">
          {days}
          {t('table.days')}
        </span>
      )}
    </span>
  )
}

/* ── 行内操作按钮 ───────────────────────────────────────────
   默认只显示图标（悬停提示 + 读屏名称都写全），showLabel 时显示文字；命中区补到 44px。
   tone：accent（高频主操作，如接码）/ danger（低频高危，平时是低权重灰色，悬停才变危险色）。
   to：给了就渲染成链接（进入详情页这类导航）。 */
export function ActBtn({ icon: Icon, label, onClick, busy, disabled, tone, showLabel, to, className = '', ...rest }) {
  const cls = `mh-act ${tone ? `mh-act--${tone}` : ''} ${showLabel ? 'mh-act--label' : ''} ${className}`
  const body = (
    <>
      {busy ? <Loader2 size={14} className="mh-spin" aria-hidden /> : Icon ? <Icon size={14} aria-hidden /> : null}
      {showLabel && <span>{label}</span>}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={cls} title={label} aria-label={showLabel ? undefined : label} onClick={(e) => e.stopPropagation()} {...rest}>
        {body}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className={cls}
      title={label}
      aria-label={showLabel ? undefined : label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      {...rest}
    >
      {body}
    </button>
  )
}

/* ── 分组下拉（与统一总览的分组筛选同一个外形）────────────────
   groups: [{ name, count }]；count 为 null 时不显示计数。value='' = 全部分组。 */
export function GroupSelect({ groups, value, onChange, className = '' }) {
  const { t } = useLocale()
  return (
    <label className={`mh-select ${value ? 'is-on' : ''} ${className}`}>
      <FolderTree size={14} aria-hidden />
      <span className="sr-only">{t('ov.filter.group')}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('group.all')}</option>
        {groups.map((g) => (
          <option key={g.name} value={g.name}>
            {g.count != null ? `${g.name}（${g.count}）` : g.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="mh-select__chev" aria-hidden />
    </label>
  )
}

/* ── 分段胶囊（带计数）──────────────────────────────────────
   options: [{ value, label, count?, tone? }]；单选（WAI-ARIA radiogroup，←/→ 切换）。
   选中态是一块滑动的白底，layoutId 每个控件唯一。 */
export function SegFilter({ options, value, onChange, label, layoutId, size = '' }) {
  const values = options.map((o) => o.value)
  return (
    <div
      className={`mh-seg ${size ? `mh-seg--${size}` : ''} mh-seg--count`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => segKeyDown(e, values, value, onChange)}
    >
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value || 'all'}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`mh-seg__btn ${on ? 'is-on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {on && (
              <motion.span layoutId={layoutId} className="mh-seg__pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
            )}
            {o.tone && <span className={`mh-seg__tone mh-seg__tone--${o.tone}`} aria-hidden />}
            <span className="mh-seg__label">{o.label}</span>
            {o.count != null && <span className="mh-seg__count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ── 可复制的地址（等宽）────────────────────────────────────
   点一下就复制：剪贴板写入在点击当帧发起；成功后图标换成 ✓ 约 1.5 秒，并沿用原来的「已复制邮箱地址」提示。
   stopPropagation：复制绝不冒泡成「打开这一行」。 */
export const CopyAddr = memo(function CopyAddr({ email, q = '', className = '' }) {
  const { t } = useLocale()
  const copy = useCopy()
  const [done, setDone] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className={`mh-addr ${done ? 'is-done' : ''} ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        copy(email, { successMsg: t('dom.email.copied') }).then((ok) => {
          if (!ok) return
          setDone(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setDone(false), 1500)
        })
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={t('dom.email.copy', { email })}
      title={t('dom.email.copy', { email })}
    >
      <span className="mh-addr__text">
        <Hl text={email} q={q} />
      </span>
      {done ? <Check size={13} className="mh-addr__icon" aria-hidden /> : <Copy size={13} className="mh-addr__icon" aria-hidden />}
    </button>
  )
})

/** 验证码单元格：验证码胶囊；不是最新的码（code_fresh=false）时胶囊变灰并跟一个「历史」小标签 */
export function CodeCell({ code, stale = false, staleTitle, query = '' }) {
  const { t } = useLocale()
  if (!code) return <span className="mh-dash" aria-hidden>—</span>
  return (
    <span className="mh-codecell">
      <CodeChip code={code} size="sm" query={query} className={stale ? 'is-stale' : ''} />
      {stale && (
        <span className="mh-tag" title={staleTitle}>
          {t('code.history')}
        </span>
      )}
    </span>
  )
}

/** 列表行的悬停聚光：鼠标位置写进那一行的 CSS 变量（事件委托在列表上，不触发 React 渲染） */
export function rowSpotlight(selector) {
  return (e) => {
    const row = e.target.closest?.(selector)
    if (!row) return
    const r = row.getBoundingClientRect()
    row.style.setProperty('--mx', `${e.clientX - r.left}px`)
    row.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
}

/** 卡片悬停：聚光 + 轻微 3D 倾斜（最多约 ±4°）。倾斜只在允许动效时由 CSS 生效 */
export function tiltSpot(e) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  el.style.setProperty('--mx', `${x}px`)
  el.style.setProperty('--my', `${y}px`)
  el.style.setProperty('--ry', `${((x / r.width - 0.5) * 7).toFixed(2)}deg`)
  el.style.setProperty('--rx', `${((0.5 - y / r.height) * 7).toFixed(2)}deg`)
}
export function tiltReset(e) {
  const el = e.currentTarget
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

/** 页面里的一行说明（信息 / 警告），图标 + 文字，不只靠颜色区分 */
export function Note({ icon: Icon, tone = 'info', children, className = '' }) {
  return (
    <p className={`mh-note mh-note--${tone} ${className}`}>
      {Icon && <Icon size={14} aria-hidden />}
      <span>{children}</span>
    </p>
  )
}

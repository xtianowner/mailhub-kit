import { Link } from 'react-router-dom'
import { spotlight, useCountUp } from '../../lib/motion.js'

const nf = new Intl.NumberFormat('zh-CN')
export const fmtNum = (n) => (Number.isFinite(n) ? nf.format(n) : '—')

/** 状态灯：慢速脉冲（只动伪元素的透明度和缩放，减少动态效果时静止） */
export function StatusLight({ tone = 'ok', label }) {
  return (
    <span className={`mh-light mh-light--${tone}`} title={label}>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** 数字滚动的数字（读屏读终值，不读滚动过程） */
export function Count({ value, className = '', duration }) {
  const ref = useCountUp(value, { duration, format: fmtNum })
  return (
    <span className={className}>
      <span ref={ref} aria-hidden>
        {Number.isFinite(value) ? '0' : '—'}
      </span>
      <span className="sr-only">{fmtNum(value)}</span>
    </span>
  )
}

/** 统计卡：悬停聚光 + 数字滚动 + 可选状态灯；给了 to 就是可点的链接 */
export function StatCard({ icon: Icon, label, value, sub, light, to }) {
  const body = (
    <>
      <span className="mh-stat__label">
        <Icon size={14} aria-hidden />
        <span className="mh-stat__label-text">{label}</span>
        {light && <StatusLight tone={light.tone} label={light.label} />}
      </span>
      <Count value={value} className="mh-stat__value" />
      {sub && <span className="mh-stat__sub">{sub}</span>}
    </>
  )
  return to ? (
    <Link to={to} className="mh-stat is-link" onMouseMove={spotlight}>
      {body}
    </Link>
  ) : (
    <div className="mh-stat" onMouseMove={spotlight}>
      {body}
    </div>
  )
}

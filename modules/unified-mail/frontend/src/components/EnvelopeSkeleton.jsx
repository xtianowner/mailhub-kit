/** 信封形态的加载骨架：每一行是一只小信封 + 几条占位文字，宽度和真实行一致（数据到了原位替换、不跳动）。
 *  微光扫过是 CSS 动画，系统「减少动态效果」时停住。 */
const WIDTHS = [72, 58, 80, 64, 76, 52]

export function EnvelopeSkeleton({ rows = 6, label, className = '' }) {
  return (
    <div className={`mh-skel ${className}`} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mh-skel__row" aria-hidden style={{ '--d': `${i * 0.08}s` }}>
          <span className="mh-skel__env">
            <span className="mh-skel__flap" />
          </span>
          <span className="mh-skel__lines">
            <span className="mh-skel__bar" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
            <span className="mh-skel__bar is-short" style={{ width: `${WIDTHS[(i + 3) % WIDTHS.length] / 2}%` }} />
          </span>
          <span className="mh-skel__pill" />
        </div>
      ))}
    </div>
  )
}

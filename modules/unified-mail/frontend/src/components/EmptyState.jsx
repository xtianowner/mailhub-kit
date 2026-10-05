import { BrandFigure } from './brand/BrandFigure.jsx'

/** 空状态 / 出错状态（展示层）：品牌形象 + 一句标题 + 说明 + 出口按钮。
 *  pose：search（没找到）/ wait（还没有信）；tone=danger 时标题前加图标，不只靠颜色区分。 */
export function EmptyState({ pose = 'search', title, desc, action, tone, icon: Icon, size = 'md', className = '' }) {
  return (
    <div className={`mh-empty mh-empty--${size} ${tone ? `is-${tone}` : ''} ${className}`}>
      <BrandFigure pose={pose} decorative className="mh-empty__fig" />
      <div className="mh-empty__text">
        <p className="mh-empty__title">
          {Icon && <Icon size={16} aria-hidden />}
          {title}
        </p>
        {desc && <p className="mh-empty__desc">{desc}</p>}
        {action && <div className="mh-empty__actions">{action}</div>}
      </div>
    </div>
  )
}

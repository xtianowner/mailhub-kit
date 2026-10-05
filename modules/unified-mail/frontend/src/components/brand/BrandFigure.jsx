import { useState } from 'react'
import { brand, brandFigure } from '../../brand/index.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'

/* 品牌形象（展示层用：登录页、空状态、404、加载）。从品牌包取图，组件不关心是哪个品牌：
   - 位图形象（作者品牌包的手办）：<img> + 待机缓慢上下浮动；hero 姿势在封蜡处叠一层呼吸光；
   - 矢量插画（通用品牌包的信封）：直接画 SVG，同样的浮动，封蜡呼吸光画在 SVG 里。
   待机动作都是 CSS 动画，系统「减少动态效果」时由 tokens.css 的全局规则停掉。
   decorative=true：旁边已有文字说明时不重复播报（alt 置空）。 */
export function BrandFigure({ pose = 'hero', idle = true, eager = false, decorative = false, className = '' }) {
  const { locale } = useLocale()
  const fig = brandFigure(pose)
  const [loaded, setLoaded] = useState(false)
  if (!fig) return null
  const style = { '--fig-ar': `${fig.width} / ${fig.height}` }
  const cls = `mh-figure mh-figure--${pose} ${idle ? 'is-idle' : ''} ${className}`

  if (fig.src) {
    const alt = decorative ? '' : fig.alt?.[locale] || fig.alt?.zh || ''
    return (
      <span className={`${cls} ${loaded ? 'is-loaded' : ''}`} style={style}>
        <span className="mh-figure__float">
          <img
            src={fig.src}
            width={fig.width}
            height={fig.height}
            alt={alt}
            decoding="async"
            loading={eager ? 'eager' : 'lazy'}
            fetchpriority={eager ? 'high' : undefined}
            className="mh-figure__img"
            onLoad={() => setLoaded(true)}
            ref={(el) => {
              if (el?.complete && el.naturalWidth && !loaded) setLoaded(true)
            }}
          />
          {fig.seal && (
            <span
              className="mh-figure__seal"
              style={{ left: `${fig.seal[0] * 100}%`, top: `${fig.seal[1] * 100}%` }}
              aria-hidden
            />
          )}
        </span>
      </span>
    )
  }

  const Art = brand.art
  if (!Art) return null
  return (
    // 矢量插画只是装饰（用到它的地方旁边都有文字说明），对读屏隐藏
    <span className={`${cls} is-loaded mh-figure--art`} style={style} aria-hidden>
      <span className="mh-figure__float">
        <Art pose={pose} />
      </span>
    </span>
  )
}

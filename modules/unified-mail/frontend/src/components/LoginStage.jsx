import { useCallback, useMemo } from 'react'
import { brandFigure } from '../brand/index.js'
import { IS_CLOUD } from '../lib/hubApi.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { HubFlow } from './overview/HubFlow.jsx'
import { BrandFigure } from './brand/BrandFigure.jsx'

/* 登录页左侧的展示区（只在宽屏、表单就绪之后挂载）：
   汇流动画全尺寸版——几类信箱作为来源节点，光点沿曲线汇进品牌形象怀里那封信的封蜡；
   形象待机缓慢上下浮动、封蜡呼吸发光。登录前拿不到任何数据，节点只写来源类型、不显示数字。
   形象的位置与 hubAt 用同一组比例（和 hub.css 的 .mh-stage__fig 一致），光点才能正好落在封蜡上。 */
const FIG = { right: 0.06, bottom: 0.04, height: 0.88 }

export default function LoginStage() {
  const { t } = useLocale()
  const fig = brandFigure('hero')
  const ar = fig ? fig.width / fig.height : 0.6
  const seal = fig?.seal || [0.5, 0.6]
  const nodes = useMemo(
    () =>
      (IS_CLOUD
        ? [
            { id: 'd', kind: 'domain', title: t('login.flow.domain'), rate: 1.8 },
            { id: 's', kind: 'domain', title: t('login.flow.sub'), rate: 1.2 },
            { id: 'p', kind: 'domain', title: t('login.flow.prefix'), rate: 0.9 },
          ]
        : [
            { id: 'h', kind: 'hotmail', title: t('login.flow.hotmail'), rate: 2 },
            { id: 'd', kind: 'domain', title: t('login.flow.domain'), rate: 1.4 },
            { id: 'p', kind: 'domain', title: t('login.flow.prefix'), rate: 0.9 },
          ]),
    [t],
  )
  const hubAt = useCallback(
    (w, h) => {
      const fh = h * FIG.height
      const fw = fh * ar
      const left = w - w * FIG.right - fw
      const top = h - h * FIG.bottom - fh
      return { x: left + seal[0] * fw, y: top + seal[1] * fh, r: 0 }
    },
    [ar, seal],
  )

  return (
    <div className="mh-stage" aria-hidden>
      <span className="mh-stage__glow" />
      <HubFlow mode="stage" nodes={nodes} hubAt={hubAt} outflow={false} />
      <BrandFigure pose="hero" decorative eager className="mh-stage__fig" />
    </div>
  )
}

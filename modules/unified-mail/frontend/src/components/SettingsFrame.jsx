import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { PageHeader } from './hub.jsx'

/* 设置页的侧栏子导航框架（基线 §6，安静、不加展示层效果）：
   左侧竖排子导航贴内容区左缘，桌面端随页面 sticky；右侧是当前子页，表单限可读宽度左对齐。
   手机宽度折成内容区上方的一排胶囊。当前子页落在 URL（?s=），刷新 / 分享不丢，浏览器后退可回到上一个子页。
   sections: [{ key, icon, label, desc }]；children(key) 渲染当前子页。 */
export function useSettingsSection(sections) {
  const [params] = useSearchParams()
  const want = params.get('s')
  return sections.some((s) => s.key === want) ? want : sections[0].key
}

export function SettingsFrame({ title, subtitle, sections, current, children }) {
  const { t } = useLocale()
  const cur = sections.find((s) => s.key === current) || sections[0]
  return (
    <div className="mh-page">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="mh-split">
        <nav className="mh-subnav" aria-label={t('st.subnav')}>
          {sections.map(({ key, icon: Icon, label }) => {
            const on = key === cur.key
            return (
              <Link key={key} to={`?s=${key}`} className={`mh-subnav__item ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined}>
                {on && (
                  <motion.span layoutId="mh-subnav-pill" className="mh-subnav__pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                )}
                <Icon size={16} aria-hidden />
                <span>{label}</span>
              </Link>
            )
          })}
        </nav>
        <section className="mh-card mh-panel" aria-labelledby="mh-panel-title">
          <header className="mh-panel__head">
            <h2 id="mh-panel-title" className="mh-h2">
              {cur.label}
            </h2>
            {cur.desc && <p className="mh-panel__desc">{cur.desc}</p>}
          </header>
          <div className="mh-panel__body">{children}</div>
        </section>
      </div>
    </div>
  )
}

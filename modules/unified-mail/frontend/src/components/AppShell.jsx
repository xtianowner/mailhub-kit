import { Suspense } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { Cloud, Languages, LayoutDashboard, LogOut, Mailbox, Moon, Settings, Sun } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { IS_CLOUD } from '../lib/hubApi.js'
import { EASE, useScrolled } from '../lib/motion.js'
import { brand } from '../brand/index.js'
import { EnvelopeSkeleton } from './EnvelopeSkeleton.jsx'

// 导航只有三项：统一总览 ｜ Hotmail 账号 ｜ 域名邮箱（云端版：总览 ｜ 域名邮箱）。
// 总览是跨来源的日常入口，后两个是各自的深度管理；设置放在侧栏底部（窄屏放在顶栏右侧图标区）。
const NAV = [
  { to: '/', end: true, icon: LayoutDashboard, key: 'nav.hub', cloudKey: 'nav.hub.cloud' },
  // Hotmail 账号池只在本地版有；云端版连这个入口都不该出现
  { to: '/hotmail', icon: Mailbox, key: 'nav.hotmail', localOnly: true },
  { to: '/domain', icon: Cloud, key: 'nav.domain' },
].filter((item) => !(item.localOnly && IS_CLOUD))

function NavItems({ variant }) {
  const { t } = useLocale()
  return NAV.map(({ to, end, icon: Icon, key, cloudKey }) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => `mh-nav mh-nav--${variant} ${isActive ? 'is-on' : ''}`}>
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={`mh-nav-${variant}`}
              className="mh-nav__pill"
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          )}
          <Icon size={16} aria-hidden />
          <span className="mh-nav__label">{t(IS_CLOUD && cloudKey ? cloudKey : key)}</span>
        </>
      )}
    </NavLink>
  ))
}

/** 页面转场：只在换页面（pathname）时播放，淡入 + 上移 6px，总时长 0.28s（≤ 400ms）；
 *  筛选、打开抽屉这类只改查询串的操作不触发。结束后 transform 归 none，不影响页内 fixed 弹层。 */
function PageTransition({ children }) {
  const { pathname } = useLocation()
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/** 统一外壳：磨砂顶栏（滚动后加阴影）+ 侧栏（贴外框左缘，设置在底部）+ 页脚。
 *  1280 以下侧栏收成顶栏下的一排标签，设置变成顶栏右侧的图标。 */
export function AppShell({ children }) {
  const { theme, toggle: toggleTheme } = useTheme()
  const { t, locale, toggle: toggleLocale } = useLocale()
  const { authEnabled, logout } = useAuth()
  const toast = useToast()
  const scrolled = useScrolled()

  const onLogout = async () => {
    await logout()
    toast.info(t('auth.loggedOut'))
  }
  const credit = brand.credit

  return (
    <div className="mh-app">
      <a href="#main" className="mh-skip">
        {t('common.skipToContent')}
      </a>

      <header className={`mh-top ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="app-frame mh-top__row">
          <NavLink to="/" end className="mh-brand" aria-label={t('shell.home')}>
            <span className="mh-brand__mark">
              <Mailbox size={17} aria-hidden />
            </span>
            <span className="mh-brand__text">
              <span className="mh-brand__name">{t('app.title')}</span>
              <span className="mh-brand__sub">{t('app.subtitle')}</span>
            </span>
          </NavLink>
          <div className="mh-top__actions">
            <button type="button" className="mh-icon-btn mh-lang" title={t('lang.switchTitle')} aria-label={t('lang.switchTitle')} onClick={toggleLocale}>
              <Languages size={17} aria-hidden />
              <span className="mh-lang__code" aria-hidden>
                {t('lang.switch')}
              </span>
            </button>
            <button type="button" className="mh-icon-btn" title={t('theme.toggle')} aria-label={t('theme.toggle')} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <NavLink
              to="/settings"
              className={({ isActive }) => `mh-icon-btn mh-hide-xl ${isActive ? 'is-on' : ''}`}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
            >
              <Settings size={17} />
            </NavLink>
            {authEnabled && (
              <button type="button" className="mh-icon-btn" title={t('auth.logout')} aria-label={t('auth.logout')} onClick={onLogout}>
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
        <nav className="mh-tabs" aria-label={t('shell.nav')}>
          <div className="app-frame mh-tabs__row">
            <NavItems variant="tab" />
          </div>
        </nav>
      </header>

      <div className="app-frame mh-body">
        <aside className="mh-side">
          <nav className="mh-side__nav" aria-label={t('shell.nav')}>
            <NavItems variant="side" />
          </nav>
          <div className="mh-side__foot">
            <NavLink to="/settings" className={({ isActive }) => `mh-nav mh-nav--side ${isActive ? 'is-on' : ''}`}>
              <Settings size={16} aria-hidden />
              <span className="mh-nav__label">{t('nav.settings')}</span>
            </NavLink>
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="mh-main">
          <PageTransition>
            <Suspense fallback={<EnvelopeSkeleton rows={5} label={t('common.loading')} className="mh-skel--page" />}>
              {children}
            </Suspense>
          </PageTransition>
        </main>
      </div>

      <footer className="app-frame mh-foot">
        {credit ? (
          <span>
            by {credit.name} ·{' '}
            <a href={credit.href} target="_blank" rel="noreferrer">
              {credit.label?.[locale] || credit.label?.zh}
            </a>
          </span>
        ) : (
          <span>{t('app.title')}</span>
        )}
      </footer>
    </div>
  )
}

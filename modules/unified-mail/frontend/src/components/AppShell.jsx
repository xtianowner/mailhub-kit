import { NavLink } from 'react-router-dom'
import {
  Cloud,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mailbox,
  Settings,
  Sun,
  Moon,
  Languages,
} from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { IconButton } from './ui.jsx'
import { IS_CLOUD } from '../lib/hubApi.js'

// 统一外壳。导航按「先统一、后分源」排：
//   总览 → 统一收件箱 → 统一接码 ｜ Hotmail 账号 → 域名邮箱
// 前三个是跨来源的日常动作，后两个是各自的深度管理。设置属于工具类，
// 收进右侧图标区，不跟主导航抢位置（小屏 6 个主项会挤爆 375px）。
const NAV = [
  { to: '/', end: true, icon: LayoutDashboard, key: 'nav.hub', cloudKey: 'nav.hub.cloud' },
  { to: '/inbox', icon: Inbox, key: 'nav.inbox', cloudKey: 'nav.inbox.cloud' },
  { to: '/code', icon: KeyRound, key: 'nav.code', cloudKey: 'nav.code.cloud' },
  // Hotmail 账号池只在本地版有；云端版连这个入口都不该出现
  { to: '/hotmail', icon: Mailbox, key: 'nav.hotmail', localOnly: true },
  { to: '/domain', icon: Cloud, key: 'nav.domain' },
].filter((item) => !(item.localOnly && IS_CLOUD))

export function AppShell({ children }) {
  const { theme, toggle: toggleTheme } = useTheme()
  const { t, toggle: toggleLocale } = useLocale()
  const { authEnabled, logout } = useAuth()
  const toast = useToast()

  const onLogout = async () => {
    await logout()
    toast.info(t('auth.loggedOut'))
  }

  const linkCls = ({ isActive }) =>
    cn(
      'flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors duration-fast sm:px-3',
      isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
    )

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-modal focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-text focus:ring-1 focus:ring-accent"
      >
        {t('common.skipToContent')}
      </a>

      <header className="sticky top-0 z-sticky border-b border-border/60 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient text-on-bright">
              <Mailbox size={17} />
            </span>
            <span className="hidden flex-col leading-none md:flex">
              <span className="font-heading text-sm font-semibold text-text">{t('app.title')}</span>
              <span className="text-[11px] text-subtle">{t('app.subtitle')}</span>
            </span>
          </NavLink>

          {/* 窄屏放不下 5 个带字标签时导航自己横向可滚，绝不把页面撑出横滚条 */}
          <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map(({ to, end, icon: Icon, key, cloudKey }) => (
              <NavLink key={to} to={to} end={end} className={linkCls}>
                <Icon size={15} aria-hidden />
                {/* 云端版只有域名邮箱一个来源，「统一收件箱」的说法反而绕 */}
                <span className="hidden lg:inline">{t(IS_CLOUD && cloudKey ? cloudKey : key)}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded transition-colors duration-fast',
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )
              }
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
            >
              <Settings size={17} />
            </NavLink>
            <IconButton title={t('lang.switch')} onClick={toggleLocale}>
              <Languages size={17} />
            </IconButton>
            <IconButton title={t('theme.toggle')} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
            {authEnabled && (
              <IconButton title={t('auth.logout')} onClick={onLogout}>
                <LogOut size={17} />
              </IconButton>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}

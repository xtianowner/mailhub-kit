import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { ToastProvider } from './lib/toast.jsx'
import { LiveAnnouncer } from './lib/announce.jsx'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import { IS_CLOUD } from './lib/hubApi.js'
import { useLocale } from './i18n/LocaleProvider.jsx'
import { EnvelopeSkeleton } from './components/EnvelopeSkeleton.jsx'
import LoginPage from './pages/LoginPage.jsx'

// 路由级懒加载：登录页随首屏一起到（打开 1 秒内可输入），外壳与各页面进门后按需加载。
const AppShell = lazy(() => import('./components/AppShell.jsx').then((m) => ({ default: m.AppShell })))
// 统一层
const HubOverviewPage = lazy(() => import('./pages/HubOverviewPage.jsx'))
const DomainMailPage = lazy(() => import('./pages/DomainMailPage.jsx'))
const MessageDetailPage = lazy(() => import('./pages/MessageDetailPage.jsx'))
// Hotmail 侧（自 hotmail-graph 继承，挂在 /hotmail 前缀下，契约不变）
const OverviewPage = lazy(() => import('./pages/OverviewPage.jsx'))
const AliasesPage = lazy(() => import('./pages/AliasesPage.jsx'))
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'))
const MessagePage = lazy(() => import('./pages/MessagePage.jsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))
const CloudSettingsPage = lazy(() => import('./pages/CloudSettingsPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

// 统一收件箱已并进统一总览：旧书签带的筛选（q / only_codes / group …）原样带过去
function LegacyInboxRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/', search }} replace />
}

// 统一接码已删除（总览的搜索 + 只看带验证码覆盖了它）：旧链接 /code?email=x 落到总览并按该地址搜索
function LegacyCodeRedirect() {
  const [params] = useSearchParams()
  const email = (params.get('email') || '').trim()
  return <Navigate to={email ? `/?q=${encodeURIComponent(email)}` : '/'} replace />
}

function BootSkeleton() {
  const { t } = useLocale()
  return (
    <div className="app-frame mh-boot">
      <EnvelopeSkeleton rows={4} label={t('common.loading')} className="mh-skel--page" />
    </div>
  )
}

// Decides between: auth-status still loading → 信封骨架; login required → LoginPage;
// otherwise → the routed app. auth_enabled=false keeps everything open (default).
function Gate() {
  const { status, requiresLogin } = useAuth()
  if (status === 'checking') return <BootSkeleton />
  if (requiresLogin) return <LoginPage />
  return (
    <Suspense fallback={<BootSkeleton />}>
      <AppShell>
        <Routes>
          {/* 两个目标共有：域名邮箱相关的全部页面 */}
          <Route path="/" element={<HubOverviewPage />} />
          <Route path="/inbox" element={<LegacyInboxRedirect />} />
          <Route path="/code" element={<LegacyCodeRedirect />} />
          <Route path="/domain" element={<DomainMailPage />} />
          {/* 统一邮件详情：两个来源同一个页面。hotmail 侧用 ?account_id= 补上账号 */}
          <Route path="/message/:source/:id" element={<MessageDetailPage />} />

          {/* Hotmail 账号池只在本地版存在 —— 云端不碰 Hotmail 凭据 */}
          {!IS_CLOUD && (
            <>
              <Route path="/hotmail" element={<OverviewPage />} />
              <Route path="/hotmail/aliases" element={<AliasesPage />} />
              <Route path="/hotmail/accounts/:id" element={<AccountPage />} />
              <Route path="/hotmail/accounts/:id/messages/:mid" element={<MessagePage />} />
              {/* 老书签兼容：原 hotmail-graph 的裸路径重定向到 /hotmail 下 */}
              <Route path="/accounts/*" element={<Navigate to="/hotmail" replace />} />
              <Route path="/aliases" element={<Navigate to="/hotmail/aliases" replace />} />
            </>
          )}

          <Route path="/settings" element={IS_CLOUD ? <CloudSettingsPage /> : <SettingsPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </Suspense>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
      <LiveAnnouncer />
    </ToastProvider>
  )
}

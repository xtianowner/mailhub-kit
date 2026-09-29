import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './lib/toast.jsx'
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx'
import { AppShell } from './components/AppShell.jsx'
import { IS_CLOUD } from './lib/hubApi.js'
import { StateBlock } from './components/StateBlock.jsx'
import LoginPage from './pages/LoginPage.jsx'
// 统一层
import HubOverviewPage from './pages/HubOverviewPage.jsx'
import UnifiedInboxPage from './pages/UnifiedInboxPage.jsx'
import UnifiedCodePage from './pages/UnifiedCodePage.jsx'
import DomainMailPage from './pages/DomainMailPage.jsx'
import MessageDetailPage from './pages/MessageDetailPage.jsx'
// Hotmail 侧（自 hotmail-graph 继承，挂在 /hotmail 前缀下，契约不变）
import OverviewPage from './pages/OverviewPage.jsx'
import AliasesPage from './pages/AliasesPage.jsx'
import AccountPage from './pages/AccountPage.jsx'
import MessagePage from './pages/MessagePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import CloudSettingsPage from './pages/CloudSettingsPage.jsx'

// Calm tool-dashboard backdrop: one static, low-opacity mesh tint fixed behind
// everything so the page isn't flat single-colour — but no particles / motion
// (per spec: this is a console, density over spectacle).
function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <div className="absolute inset-0 bg-mesh opacity-40" />
      <div className="absolute inset-0 bd-vignette" />
    </div>
  )
}

function NotFound() {
  return <StateBlock state="empty" message="页面不存在 / Page not found" />
}

// Decides between: auth-status still loading → spinner; login required → LoginPage;
// otherwise → the routed app. auth_enabled=false keeps everything open (default).
function Gate() {
  const { status, requiresLogin } = useAuth()
  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <StateBlock state="loading" />
      </div>
    )
  }
  if (requiresLogin) return <LoginPage />
  return (
    <AppShell>
      <Routes>
        {/* 两个目标共有：域名邮箱相关的全部页面 */}
        <Route path="/" element={<HubOverviewPage />} />
        <Route path="/inbox" element={<UnifiedInboxPage />} />
        <Route path="/code" element={<UnifiedCodePage />} />
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

        <Route
          path="/settings"
          element={IS_CLOUD ? <CloudSettingsPage /> : <SettingsPage />}
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Backdrop />
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}

import { useState } from 'react'
import { Mailbox, KeyRound, LogIn, Sun, Moon, Languages, User } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { IS_CLOUD } from '../lib/hubApi.js'
import { Button, Card, IconButton } from '../components/ui.jsx'

// 登录墙。两个目标的凭据形态不同：
//   本地版 → 单个访问令牌（仅在设了 HUB_API_TOKEN 时才出现，默认不启用）
//   云端版 → 账号 + 密码，交给网关 Worker 校验并签发会话 Cookie
// 云端版之所以用账号密码而不是直接填 CFMail 密钥：那两串 40+ 字符的 token
// 没人记得住，且不该进浏览器 —— 它们现在只活在 Worker 的加密环境变量里。
export default function LoginPage() {
  const { t } = useLocale()
  const { theme, toggle: toggleTheme } = useTheme()
  const { toggle: toggleLocale } = useLocale()
  const toast = useToast()
  const { login } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const canSubmit = IS_CLOUD ? username.trim() && password : token.trim()

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    try {
      const ok = await login(
        IS_CLOUD ? { username: username.trim(), password } : token.trim(),
      )
      if (ok) toast.success(t('login.success'))
      else toast.error(t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'h-11 w-full rounded border border-border bg-surface-2/60 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40'

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-3 top-3 flex items-center gap-1">
        <IconButton title={t('lang.switch')} onClick={toggleLocale}>
          <Languages size={17} />
        </IconButton>
        <IconButton title={t('theme.toggle')} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>
      </div>

      <Card className="flex w-full max-w-sm flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient text-on-bright shadow-glow">
            <Mailbox size={24} />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-lg font-semibold text-text">
              {t(IS_CLOUD ? 'login.title.cloud' : 'login.title')}
            </h1>
            <p className="text-sm text-muted">
              {t(IS_CLOUD ? 'login.subtitle.cloud' : 'login.subtitle')}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {IS_CLOUD ? (
            <>
              <div className="relative">
                <User
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('login.username')}
                  aria-label={t('login.username')}
                  className={inputCls}
                />
              </div>
              <div className="relative">
                <KeyRound
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.password')}
                  aria-label={t('login.password')}
                  className={inputCls}
                />
              </div>
            </>
          ) : (
            <div className="relative">
              <KeyRound
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('login.token.placeholder')}
                aria-label={t('login.token.placeholder')}
                className={inputCls}
              />
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!canSubmit}
            className="w-full"
          >
            {!busy && <LogIn size={16} />}
            {t('login.submit')}
          </Button>
        </form>

        {IS_CLOUD && <p className="text-center text-xs text-subtle">{t('login.hint.cloud')}</p>}
      </Card>
    </div>
  )
}

import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, Mailbox, KeyRound, LogIn, Sun, Moon, Languages, User } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { useAuth } from '../auth/AuthProvider.jsx'
import { IS_CLOUD } from '../lib/hubApi.js'
import { Button, IconButton } from '../components/ui.jsx'
import { BrandFigure } from '../components/brand/BrandFigure.jsx'

// 左侧展示区（汇流动画 + 品牌形象）单独成块、晚于表单加载：表单随首屏到达，打开即可输入，动画不挡输入。
const LoginStage = lazy(() => import('../components/LoginStage.jsx'))

/** 宽屏（≥ 1024）且首帧画完之后才挂载展示区；手机上只显示登录卡 */
function useStageReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    let timer = 0
    const decide = () => {
      clearTimeout(timer)
      if (mq.matches) timer = setTimeout(() => setReady(true), 250)
      else setReady(false)
    }
    decide()
    mq.addEventListener('change', decide)
    return () => {
      clearTimeout(timer)
      mq.removeEventListener('change', decide)
    }
  }, [])
  return ready
}

// 登录墙（展示层）：左侧汇流动画 + 品牌形象，右侧磨砂登录卡；手机上只有登录卡，上方一个小号形象。
// 下面的登录逻辑、限速提示、错误提示与改版前完全一致，只换了外围版式。
// 两个目标的凭据形态不同：
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
  const [loginError, setLoginError] = useState('')
  const stageReady = useStageReady()

  const canSubmit = IS_CLOUD ? username.trim() && password : token.trim()

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setLoginError('')
    try {
      const ok = await login(
        IS_CLOUD ? { username: username.trim(), password } : token.trim(),
      )
      if (ok) toast.success(t('login.success'))
      else toast.error(t('login.failed'))
    } catch (err) {
      setLoginError(err?.status === 429
        ? t('login.rateLimited', { seconds: Math.max(1, err.retryAfter || 60) })
        : t('login.unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'h-11 w-full rounded border border-border bg-surface-2 pl-9 pr-3 text-sm text-text placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25'

  return (
    <div className="mh-login">
      <div className="mh-login__tools">
        <IconButton title={t('lang.switchTitle')} onClick={toggleLocale}>
          <Languages size={17} />
        </IconButton>
        <IconButton title={t('theme.toggle')} onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>
      </div>

      <section className="mh-login__show" aria-label={t('login.show.label')}>
        <div className="mh-login__intro">
          <span className="mh-login__eyebrow">
            <span className="mh-brand__mark mh-brand__mark--sm" aria-hidden>
              <Mailbox size={15} />
            </span>
            {t('app.title')}
          </span>
          <p className="mh-login__tagline">{t(IS_CLOUD ? 'login.tagline.cloud' : 'login.tagline')}</p>
          <p className="mh-login__sub">{t(IS_CLOUD ? 'login.tagsub.cloud' : 'login.tagsub')}</p>
        </div>
        <div className="mh-login__stage">
          {stageReady && (
            <Suspense fallback={null}>
              <LoginStage />
            </Suspense>
          )}
        </div>
      </section>

      <main className="mh-login__side">
        <div className="mh-login__mini" aria-hidden>
          <BrandFigure pose="hero" decorative idle={false} />
        </div>
        <div className="mh-login__card flex w-full max-w-sm flex-col gap-5 p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-fill text-accent-fg shadow">
              <Mailbox size={24} />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="font-heading text-lg font-semibold text-heading">
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

            {/* 报错不只靠红色：配错误图标（色弱也能分辨），图标本身对读屏隐藏 */}
            {loginError && (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0">{loginError}</span>
              </p>
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
        </div>
      </main>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Code2, Eye, ImageOff, Type } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useTheme } from '../theme/ThemeProvider.jsx'

/* ── 邮件正文渲染 ─────────────────────────────────────────────
   邮件 HTML 是**不可信输入**（任何人都能往你信箱里发东西），所以：

   1. 一律放进 `<iframe sandbox>` 且**不给 allow-scripts** —— 脚本、表单、
      顶层跳转、同源访问全部禁掉。绝不用 innerHTML 直接塞。
   2. 默认**屏蔽远程图片**。营销/钓鱼邮件里的 1x1 追踪像素靠远程图片请求
      回报「这封信被谁在什么时候打开了」，默认加载等于自动回执。想看再点。
   3. iframe 里再挂一道 CSP，把默认拉取全部掐掉，只在用户点了「显示图片」
      后放行 img —— 双保险，不依赖单一机制。

   两种视图：原始排版（HTML）/ 纯文本。只有一种时不显示切换。 */

const INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])
const MAX_INLINE_IMAGE_BYTES = 1024 * 1024
const REMOTE_URL = /^(?:https?:)?\/\//i
const QUOTED_IMAGE_ATTRIBUTE = /\s(src|srcset|background)\s*=\s*(["'])(.*?)\2/gi
const UNQUOTED_IMAGE_ATTRIBUTE = /\s(src|srcset|background)\s*=\s*([^\s>]+)/gi

function normalizeContentId(value) {
  let result = String(value || '').trim().replace(/^cid:/i, '')
  try {
    result = decodeURIComponent(result)
  } catch {
    /* 非 URL 编码的 Content-ID 直接沿用 */
  }
  return result.replace(/^<|>$/g, '').trim().toLowerCase()
}

function inlineImageMap(inlineImages = []) {
  const result = new Map()
  for (const image of inlineImages || []) {
    const contentId = normalizeContentId(image?.content_id)
    const mimeType = String(image?.mime_type || '').toLowerCase()
    const data = String(image?.data_base64 || '').replace(/\s+/g, '')
    const size = Number(image?.size || 0)
    if (!contentId || !INLINE_IMAGE_TYPES.has(mimeType)) continue
    if (!data || !/^[a-z0-9+/]+={0,2}$/i.test(data)) continue
    if (size <= 0 || size > MAX_INLINE_IMAGE_BYTES) continue
    result.set(contentId, `data:${mimeType};base64,${data}`)
  }
  return result
}

function replaceCidImages(html, inlineImages) {
  const images = inlineImageMap(inlineImages)
  if (!images.size) return html
  return html.replace(/cid:([^\s"')>]+)/gi, (match, contentId) => {
    return images.get(normalizeContentId(contentId)) || match
  })
}

function hasRemoteCandidate(value) {
  return String(value || '')
    .split(',')
    .some((candidate) => REMOTE_URL.test(candidate.trim()))
}

function blockRemoteImages(html) {
  // 只移除会连外网的图片属性；cid 已替换成 data:，原生 data: 也继续显示。
  return html
    .replace(QUOTED_IMAGE_ATTRIBUTE, (match, name, quote, value) =>
      hasRemoteCandidate(value) ? ` data-blocked-${name}=${quote}${value}${quote}` : match,
    )
    .replace(UNQUOTED_IMAGE_ATTRIBUTE, (match, name, value) =>
      hasRemoteCandidate(value) ? ` data-blocked-${name}=${value}` : match,
    )
}

function containsRemoteImages(html) {
  QUOTED_IMAGE_ATTRIBUTE.lastIndex = 0
  UNQUOTED_IMAGE_ATTRIBUTE.lastIndex = 0
  let match
  while ((match = QUOTED_IMAGE_ATTRIBUTE.exec(html))) {
    if (hasRemoteCandidate(match[3])) return true
  }
  while ((match = UNQUOTED_IMAGE_ATTRIBUTE.exec(html))) {
    if (hasRemoteCandidate(match[2])) return true
  }
  return /url\(\s*["']?(?:https?:)?\/\//i.test(html)
}

function buildSrcDoc(html, { allowRemoteImages, dark, textColor, accentColor }) {
  const csp = allowRemoteImages
    ? "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; font-src data:;"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"
  const body = allowRemoteImages ? html : blockRemoteImages(html)
  // 邮件 HTML 自带一堆行内样式，这里只补最基础的可读性底座，不去覆盖它的排版。
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  html,body { margin:0; padding:16px; background:transparent;
    color:${textColor};
    font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    overflow-wrap:anywhere; word-break:break-word; }
  a { color:${accentColor}; }
  img,table { max-width:100% !important; height:auto; }
  table { border-collapse:collapse; }
  pre { white-space:pre-wrap; }
</style></head><body>${body}</body></html>`
}

export function MailBody({ html, text, inlineImages = [], messageKey, className }) {
  const { t } = useLocale()
  const { theme } = useTheme()
  const hasHtml = Boolean(html && html.trim())
  const hasText = Boolean(text && text.trim())
  const [mode, setMode] = useState(hasHtml ? 'html' : 'text')
  const [allowRemoteImages, setAllowRemoteImages] = useState(false)

  useEffect(() => {
    setMode(hasHtml ? 'html' : 'text')
    setAllowRemoteImages(false)
  }, [messageKey, html, text, hasHtml])

  const dark = theme !== 'light'
  const emailHtml = useMemo(() => replaceCidImages(html || '', inlineImages), [html, inlineImages])
  const hasRemote = useMemo(() => containsRemoteImages(emailHtml), [emailHtml])

  const srcDoc = useMemo(
    () => {
      if (!hasHtml || typeof document === 'undefined') return ''
      const styles = getComputedStyle(document.documentElement)
      const textColor = styles.getPropertyValue('--text').trim() || 'currentColor'
      const accentColor = styles.getPropertyValue('--accent-hover').trim() || 'currentColor'
      return buildSrcDoc(emailHtml, {
        allowRemoteImages,
        dark,
        textColor,
        accentColor,
      })
    },
    [emailHtml, hasHtml, allowRemoteImages, dark],
  )

  if (!hasHtml && !hasText) {
    return (
      <p className={cn('py-8 text-center text-sm text-subtle', className)}>
        {t('md.body.empty')}
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {(hasHtml && hasText) || hasHtml ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasHtml && hasText && (
            <div className="flex items-center gap-1">
              {[
                { key: 'html', icon: Code2, label: t('md.view.html') },
                { key: 'text', icon: Type, label: t('md.view.text') },
              ].map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  aria-pressed={mode === key}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast',
                    mode === key
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border/70 bg-surface-2/50 text-muted hover:text-text',
                  )}
                >
                  <Icon size={12} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          )}

          {hasHtml && mode === 'html' && hasRemote && (
            <button
              type="button"
              onClick={() => setAllowRemoteImages((v) => !v)}
              className={cn(
                'ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast',
                allowRemoteImages
                  ? 'border-border/70 bg-surface-2/50 text-muted hover:text-text'
                  : 'border-warning/25 bg-warning/10 text-warning hover:border-warning/40',
              )}
              title={allowRemoteImages ? t('md.images.shown') : t('md.images.blocked')}
            >
              {allowRemoteImages ? <Eye size={12} aria-hidden /> : <ImageOff size={12} aria-hidden />}
              {allowRemoteImages ? t('md.images.shown') : t('md.images.show')}
            </button>
          )}
        </div>
      ) : null}

      {mode === 'html' && hasHtml ? (
        <iframe
          // sandbox 不给 allow-scripts：邮件里的 JS 一律不执行。
          sandbox=""
          srcDoc={srcDoc}
          title={t('md.body')}
          className="h-[60vh] w-full rounded border border-border/60 bg-surface-2/30"
        />
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-surface-2/30 p-4 font-mono text-xs leading-relaxed text-text">
          {text || ''}
        </pre>
      )}
    </div>
  )
}

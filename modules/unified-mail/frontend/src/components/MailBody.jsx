import { useEffect, useMemo, useState } from 'react'
import { Code2, Eye, ImageOff, Type, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useTheme } from '../theme/ThemeProvider.jsx'
import { MailFrame, ZOOM_STEPS } from './MailFrame.jsx'

/* ── 邮件正文渲染 ─────────────────────────────────────────────
   邮件 HTML 是**不可信输入**（任何人都能往你信箱里发东西），所以：

   1. 一律放进 `<iframe sandbox>` 且**不给 allow-scripts** —— 脚本、表单、
      弹窗、顶层跳转全部禁掉。绝不用 innerHTML 直接塞。沙箱只放开 allow-same-origin，
      让父页读得到排版尺寸（适应宽度 / 高度跟随内容，见 MailFrame.jsx）；没有脚本权限，
      邮件代码在这个文档里跑不起来。
   2. 默认**屏蔽远程图片**。营销/钓鱼邮件里的 1x1 追踪像素靠远程图片请求
      回报「这封信被谁在什么时候打开了」，默认加载等于自动回执。想看再点。
   3. iframe 里再挂一道 CSP，把默认拉取全部掐掉，只在用户点了「显示图片」
      后放行 img —— 双保险，不依赖单一机制。

   两种视图：原始排版（HTML）/ 纯文本。只有一种时不显示切换。
   原始排版带缩放：默认「适应宽度」（比可用宽度宽的邮件整体等比缩小到完整可见），
   可缩小 / 放大 / 100%，放大超过宽度时外框左右滚动，内容不会被裁掉。 */

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
  // body 的 min-width: min-content：内容比视口宽时把文档撑开，而不是溢出到视口外 ——
  // 这样排版宽度量得准，居中的固定宽度表格也不会出现滚不回来的左侧负偏移。
  // 表格不再强压 max-width:100%（固定宽度的表格压不动，只会挤坏排版）；宽出来的交给外层整体缩放。
  // data-mh-mail 是给父页认文档用的标记；data-mh-measured 由父页量到尺寸后打上，
  // 此后 iframe 与内容一样大，不需要也不应该再出现内部滚动条。
  return `<!doctype html><html data-mh-mail><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  html { margin:0; padding:0; background:transparent; }
  body { margin:0; padding:16px; background:transparent;
    min-width:min-content !important;
    color:${textColor};
    font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    overflow-wrap:anywhere; word-break:break-word; }
  html[data-mh-measured] { overflow:hidden !important; }
  html[data-mh-measured] body { overflow:visible !important; }
  a { color:${accentColor}; }
  img { max-width:100% !important; height:auto; }
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
  // 缩放：'fit' = 适应宽度（默认）；数字 = 固定比例。scale 是当前实际比例（适应宽度时由 MailFrame 算出）
  const [zoom, setZoom] = useState('fit')
  const [scale, setScale] = useState(1)

  useEffect(() => {
    setMode(hasHtml ? 'html' : 'text')
    setAllowRemoteImages(false)
    setZoom('fit')
  }, [messageKey, html, text, hasHtml])

  const current = zoom === 'fit' ? scale : zoom
  const pct = Math.round(current * 100)
  const zoomOut = () => {
    const next = [...ZOOM_STEPS].reverse().find((z) => z < current - 0.005)
    if (next) setZoom(next)
  }
  const zoomIn = () => {
    const next = ZOOM_STEPS.find((z) => z > current + 0.005)
    if (next) setZoom(next)
  }

  const dark = theme !== 'light'
  const emailHtml = useMemo(() => replaceCidImages(html || '', inlineImages), [html, inlineImages])
  const hasRemote = useMemo(() => containsRemoteImages(emailHtml), [emailHtml])

  const srcDoc = useMemo(
    () => {
      if (!hasHtml || typeof document === 'undefined') return ''
      const styles = getComputedStyle(document.documentElement)
      // 设计变量是空格分隔的 RGB 三元组（「13 148 136」），进 iframe 前包成完整颜色
      const rgbVar = (name) => {
        const v = styles.getPropertyValue(name).trim()
        return v ? `rgb(${v})` : 'currentColor'
      }
      const textColor = rgbVar('--text')
      const accentColor = rgbVar('--accent-ink')
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
                      : 'border-border bg-surface-2 text-muted hover:text-text',
                  )}
                >
                  <Icon size={12} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          )}

          {hasHtml && mode === 'html' && (
            <div className="mh-zoom" role="group" aria-label={t('md.zoom.group', { pct })}>
              <button
                type="button"
                className="mh-zoom__btn"
                onClick={zoomOut}
                disabled={current <= ZOOM_STEPS[0] + 0.005}
                aria-label={t('md.zoom.out')}
                title={t('md.zoom.out')}
              >
                <ZoomOut size={14} aria-hidden />
              </button>
              <span className="mh-zoom__pct" aria-hidden>
                {pct}%
              </span>
              <button
                type="button"
                className="mh-zoom__btn"
                onClick={zoomIn}
                disabled={current >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.005}
                aria-label={t('md.zoom.in')}
                title={t('md.zoom.in')}
              >
                <ZoomIn size={14} aria-hidden />
              </button>
              <span className="mh-zoom__sep" aria-hidden />
              <button
                type="button"
                className="mh-zoom__btn mh-zoom__btn--text"
                onClick={() => setZoom('fit')}
                aria-pressed={zoom === 'fit'}
                title={t('md.zoom.fitHint')}
              >
                {t('md.zoom.fit')}
              </button>
              <button
                type="button"
                className="mh-zoom__btn mh-zoom__btn--text"
                onClick={() => setZoom(1)}
                aria-pressed={zoom === 1}
                aria-label={t('md.zoom.actualHint')}
                title={t('md.zoom.actualHint')}
              >
                {t('md.zoom.actual')}
              </button>
            </div>
          )}

          {hasHtml && mode === 'html' && hasRemote && (
            <button
              type="button"
              onClick={() => setAllowRemoteImages((v) => !v)}
              className={cn(
                'ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast',
                allowRemoteImages
                  ? 'border-border bg-surface-2 text-muted hover:text-text'
                  : 'border-warning/40 bg-warning/5 text-warning hover:border-warning',
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
        <MailFrame srcDoc={srcDoc} title={t('md.body')} zoom={zoom} onScale={setScale} />
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-2 p-4 font-mono text-xs leading-relaxed text-text">
          {text || ''}
        </pre>
      )}
    </div>
  )
}

import { forwardRef, useEffect, useRef, useState } from 'react'
import { Loader2, Copy, Check } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useCopy } from '../lib/useCopy.js'
import { useToast } from '../lib/toast.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'

/* ── Spinner ───────────────────────────────────────────── */
export function Spinner({ size = 16, className }) {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />
}

/* ── Button ────────────────────────────────────────────────
   基线 §7：主按钮（青绿底；深色模式用深色字）/ 次按钮（透明底 + 描边）/ 危险按钮（危险色），全圆角。
   variants: primary、solid = 主按钮；ghost、outline = 次按钮；subtle = 淡填充次按钮；danger = 危险。 */
const PRIMARY = 'bg-accent-fill text-accent-fg font-semibold hover:bg-accent-fill-hover disabled:opacity-50'
const VARIANTS = {
  primary: PRIMARY,
  solid: PRIMARY,
  ghost: 'bg-transparent text-text border border-border hover:bg-surface-2 hover:text-heading',
  subtle: 'bg-surface-2 text-text border border-border hover:bg-surface hover:text-heading',
  danger:
    'bg-transparent text-danger border border-danger/40 hover:border-danger disabled:opacity-50',
  outline: 'bg-transparent text-text border border-border hover:border-accent hover:text-accent',
}
const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-full',
  md: 'h-10 px-4 text-sm gap-2 rounded-full',
}

export const Button = forwardRef(function Button(
  { variant = 'subtle', size = 'md', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-fast ease-out motion-safe:active:translate-y-px',
        'disabled:cursor-not-allowed',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
})

/* ── IconButton (icon-only, requires aria-label) ─────────── */
export const IconButton = forwardRef(function IconButton(
  { className, children, title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-heading',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

/* ── Badge / status pill ──────────────────────────────────
   tone: success / warning / danger / info / subtle / accent
   浅色下警告 / 危险色压在自身 10% 底色上只有 4.1–4.4:1（不过 AA），所以这两档只铺极淡的底或不铺底。 */
const TONE = {
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/5 text-warning border-warning/40',
  danger: 'bg-transparent text-danger border-danger/40',
  info: 'bg-surface-2 text-muted border-border',
  subtle: 'bg-surface-2 text-muted border-border',
  accent: 'bg-accent/10 text-accent border-accent/25',
}
export function Badge({ tone = 'subtle', className, children, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* ── Card ──────────────────────────────────────────────────
   基线 §4：12px 圆角 + 1px 描边 + --shadow。可点的卡片另加 .card-lift（悬停上浮 + 阴影升档）。 */
export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/* ── CopyCode — 验证码展示 + 复制 ───────────────────────────────
   基线 §3：等宽、字号明显大于正文、字距略加大，原样显示大小写（绝不 uppercase）；
   旁边配复制按钮，复制成功后按钮变「已复制」约 1.5 秒。整块是一个按钮：点码或点复制都行。
   sizes: sm（表格 / 列表）/ lg（接码结果、邮件详情顶部）。
   stale=true → 不是最新的码（code_fresh===false）：变灰 + 「历史」标签 + 悬停说明，仍可复制。
   staleTitle 覆盖悬停说明（如「不是最新，2 天前」）。 */
const COPIED_MS = 1500

export function CopyCode({ code, size = 'sm', className, stale = false, staleTitle, staleLabel }) {
  const copy = useCopy()
  const toast = useToast()
  const { t } = useLocale()
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!code) return <span className="text-subtle">—</span>
  const big = size === 'lg'

  const onCopy = async () => {
    // 复制逻辑沿用 useCopy；反馈改由按钮自己承担，失败时仍走错误提示
    const ok = await copy(code, { silent: true })
    if (!ok) {
      toast.error(t('common.error'))
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    // relative：让内部的 sr-only（绝对定位）以这里为包含块，否则在可横滚的表格里会逃出裁剪、把整页撑宽
    <span className={cn('relative inline-flex max-w-full items-center gap-1.5', stale && 'flex-wrap')}>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          'group inline-flex max-w-full cursor-pointer flex-wrap items-center gap-1.5 rounded text-left',
          big && 'justify-center gap-2.5',
          className,
        )}
        title={stale ? staleTitle || t('common.copy') : t('common.copy')}
      >
        <span
          className={cn(
            'rounded border font-mono font-semibold normal-case tabular-nums tracking-[0.08em] transition-colors duration-fast',
            stale
              ? 'border-border bg-surface-2 text-muted'
              : 'text-heading group-hover:border-accent',
            big
              ? cn('px-4 py-2 text-3xl sm:text-4xl', !stale && 'border-accent/30 bg-accent/5')
              : cn('px-2 py-0.5 text-base leading-6', !stale && 'border-border bg-surface-2'),
          )}
        >
          {code}
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border font-medium transition-colors duration-fast',
            big ? 'h-9 px-3.5 text-sm' : 'h-7 min-w-7 px-1.5 text-xs',
            copied
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border bg-surface text-muted group-hover:border-accent group-hover:text-accent',
          )}
        >
          {copied ? (
            <Check size={big ? 16 : 13} aria-hidden />
          ) : (
            <Copy size={big ? 16 : 13} aria-hidden />
          )}
          {copied ? (
            <span>{t('common.copied')}</span>
          ) : big ? (
            <span>{t('common.copy')}</span>
          ) : (
            <span className="sr-only">{t('common.copy')}</span>
          )}
        </span>
      </button>
      {stale && (
        <span
          title={staleTitle}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border border-border bg-surface-2 px-1.5 font-medium text-muted',
            big ? 'py-0.5 text-xs' : 'text-[10px] leading-4',
          )}
        >
          {staleLabel || t('code.history')}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t('common.copied') : ''}
      </span>
    </span>
  )
}

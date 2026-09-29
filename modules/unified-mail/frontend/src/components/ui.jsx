import { forwardRef } from 'react'
import { Loader2, Copy } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useCopy } from '../lib/useCopy.js'

/* ── Spinner ───────────────────────────────────────────── */
export function Spinner({ size = 16, className }) {
  return <Loader2 size={size} className={cn('animate-spin', className)} aria-hidden />
}

/* ── Button ────────────────────────────────────────────────
   variants: primary (gradient, on-bright text) / solid (accent) /
   ghost / subtle / danger / outline. Sizes sm/md. loading shows spinner. */
const VARIANTS = {
  primary:
    'bg-gradient text-on-bright font-semibold shadow-glow hover:brightness-110 disabled:opacity-50',
  solid: 'bg-accent text-accent-fg font-semibold hover:bg-accent-hover disabled:opacity-50',
  ghost: 'bg-transparent text-text hover:bg-surface-2 border border-border',
  subtle: 'bg-surface-2 text-text hover:bg-surface border border-border/60',
  danger:
    'bg-transparent text-danger border border-danger/40 hover:bg-danger/10 disabled:opacity-50',
  outline: 'bg-transparent text-text border border-border hover:border-accent hover:text-accent',
}
const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded',
  md: 'h-10 px-4 text-sm gap-2 rounded',
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
        'inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-fast ease-out',
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
        'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

/* ── Badge / status pill ──────────────────────────────────
   tone: success / warning / danger / info / subtle / accent */
const TONE = {
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  info: 'bg-info/10 text-info border-info/25',
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

/* ── Card (frosted surface) ──────────────────────────────── */
export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/70 bg-surface/70 backdrop-blur-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/* ── CopyCode — clickable verification code that copies on click ─
   sizes: sm (table cell) / lg (hero code on account page).
   stale=true → code is not the freshest (code_fresh===false): greyed out,
   "history" tag + hover tooltip. Still fully copyable.
   staleTitle overrides the hover tooltip (e.g. "Not the latest, 2d ago"). */
export function CopyCode({ code, size = 'sm', className, stale = false, staleTitle, staleLabel = '历史' }) {
  const copy = useCopy()
  if (!code) return <span className="text-subtle">—</span>
  const big = size === 'lg'
  return (
    <span className={cn('inline-flex items-center gap-1.5', stale && big && 'flex-wrap')}>
      <button
        type="button"
        onClick={() => copy(code)}
        className={cn(
          'group inline-flex cursor-pointer items-center gap-1.5 rounded font-mono tabular-nums tracking-wider transition-colors duration-fast',
          stale ? 'text-subtle hover:text-muted' : 'text-text hover:text-accent',
          big
            ? cn(
                'rounded-lg border px-5 py-3 text-3xl font-semibold sm:text-4xl',
                stale ? 'border-border/50 bg-surface-2/40' : 'border-accent/30 bg-accent/5',
              )
            : 'px-1.5 py-0.5 text-sm hover:bg-surface-2',
          className,
        )}
        title={stale ? staleTitle || '点击复制 / Click to copy' : '点击复制 / Click to copy'}
      >
        {code}
        <Copy
          size={big ? 18 : 13}
          className="shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </button>
      {stale && (
        <span
          title={staleTitle}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border border-border/60 bg-surface-2/60 px-1.5 font-medium text-subtle',
            big ? 'py-0.5 text-xs' : 'text-[10px] leading-4',
          )}
        >
          {staleLabel}
        </span>
      )}
    </span>
  )
}

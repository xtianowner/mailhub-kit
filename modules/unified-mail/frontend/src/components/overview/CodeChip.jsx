import { memo, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyText } from '../../lib/motion.js'
import { announce } from '../../lib/announce.jsx'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { Hl } from './Hl.jsx'

/* ── 验证码胶囊（MailHub 专属招牌）──────────────────────────────
   等宽、原样大小写（绝不 uppercase）；胶囊背景缓慢流光（每颗错开起点，不齐刷刷闪）；
   点一下就复制：剪贴板写入在点击当帧发起，不等任何动画；点击处扩散一圈波纹，内容换成「✓ 已复制」约 1.5 秒。
   宽度由验证码本身撑开，切换「已复制」时不跳宽。读屏经 aria-live 播报结果。 */
export const CodeChip = memo(function CodeChip({ code, query = '', size = 'md', className = '' }) {
  const { t } = useLocale()
  const [copied, setCopied] = useState(false)
  const [ripples, setRipples] = useState([])
  const timer = useRef(0)
  const delay = useRef(`${(Math.random() * 3.6).toFixed(2)}s`)

  useEffect(() => () => clearTimeout(timer.current), [])

  const onClick = (e) => {
    e.stopPropagation()
    const pending = copyText(code) // 先发起复制，再做视觉反馈
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX ? e.clientX - r.left : r.width / 2
    const y = e.clientY ? e.clientY - r.top : r.height / 2
    const s = Math.max(r.width, r.height) * 2.4
    setRipples((rs) => [...rs.slice(-2), { id: performance.now(), x, y, s }])
    pending.then((ok) => {
      if (ok) {
        setCopied(true)
        announce(t('chip.copied', { code }))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      } else {
        announce(t('chip.copyFailed'), 'assertive')
      }
    })
  }

  return (
    <button
      type="button"
      className={`mh-code mh-code--${size} ${className}`}
      data-copied={copied || undefined}
      onClick={onClick}
      title={copied ? t('common.copied') : t('chip.copyTitle', { code })}
      aria-label={copied ? t('chip.copied', { code }) : t('chip.copyLabel', { code })}
      style={{ '--shine-delay': delay.current }}
    >
      <span className="mh-code__shine" aria-hidden />
      <span className="mh-code__face" aria-hidden>
        <span className="mh-code__text">
          <Hl text={code} q={query} />
        </span>
        <Copy size={size === 'lg' ? 16 : 13} className="mh-code__icon" />
      </span>
      <span className="mh-code__done" aria-hidden>
        <Check size={size === 'lg' ? 16 : 13} strokeWidth={2.6} />
        {t('common.copied')}
      </span>
      {ripples.map((rp) => (
        <span
          key={rp.id}
          className="mh-code__ripple"
          style={{ left: rp.x - rp.s / 2, top: rp.y - rp.s / 2, width: rp.s, height: rp.s }}
          onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== rp.id))}
          aria-hidden
        />
      ))}
    </button>
  )
})

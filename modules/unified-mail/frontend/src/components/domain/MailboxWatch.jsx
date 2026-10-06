import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Inbox, KeyRound, Mail, PauseCircle, RotateCcw, TimerOff } from 'lucide-react'
import { hubApi } from '../../lib/hubApi.js'
import { fmtDateTime, fmtRelative } from '../../lib/format.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { CodeChip } from '../overview/CodeChip.jsx'
import { MailDetail } from '../overview/MailDetail.jsx'
import { ActBtn, CopyAddr } from '../work.jsx'

/* 新建信箱之后的「等码」面板（放在 DetailDrawer 里）：新地址（点一下复制）→ 等待来信 / 验证码 → 收到的信。

   自动检查只调一个接口：hubApi.code(地址)，也就是域名邮箱页「接码」按钮用的那个，按地址只查这一个信箱，
   不拉信箱列表、不拉全局邮件（云端 D1 的读取额度被读爆过）。节奏：
     · 打开后第 5 秒查第一次（刚建的信箱不可能已经有信），前 1 分钟每 5 秒一次，之后每 10 秒一次；
     · 拿到验证码就停；关掉面板（组件卸载）就停；满 5 分钟就停；
     · 标签页切到后台时暂停，切回来如果还在 5 分钟内，距上次检查已满间隔就马上查一次，然后按原节奏继续；
     · 任意两次自动检查之间至少隔 5 秒；「再查一次」随时可点（只查一次，不会重新开始自动检查）。
   正常情况下 5 分钟内最多 36 次；在后台和前台之间反复切换的极端情况下也不会超过 60 次（5 分钟 ÷ 5 秒）。
   每次检查拿回来的「最新一封信」记在列表里，可以点开看全文（点开时才取一次正文）。 */
const FIRST_MS = 5_000
const FAST_MS = 5_000
const SLOW_MS = 10_000
const FAST_FOR_MS = 60_000
const WINDOW_MS = 5 * 60_000
const KEEP_MAILS = 10

const clock = (ts) => {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function MailboxWatch({ email, onCode, now }) {
  const { t, locale } = useLocale()
  const [result, setResult] = useState(null) // 最近一次检查的结果
  const [phase, setPhase] = useState('watching') // watching | paused | found | timeout
  const [checking, setChecking] = useState(false)
  const [lastAt, setLastAt] = useState(0)
  const [mails, setMails] = useState([])
  const [openMail, setOpenMail] = useState(null)

  const startRef = useRef(Date.now())
  const lastRef = useRef(0) // 上一次检查发起的时间
  const countRef = useRef(0)
  const timerRef = useRef(0)
  const inflightRef = useRef(false)
  const aliveRef = useRef(true)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const tRef = useRef(t)
  tRef.current = t

  const check = useCallback(async () => {
    if (inflightRef.current) return null
    inflightRef.current = true
    lastRef.current = Date.now()
    countRef.current += 1
    setChecking(true)
    let res
    try {
      res = await hubApi.code(email, 'domain')
    } catch (err) {
      res = { email, found: false, code: null, links: [], error: err?.userMessage || tRef.current('common.error'), message: null }
    }
    inflightRef.current = false
    if (!aliveRef.current) return null
    setChecking(false)
    setLastAt(lastRef.current)
    setResult(res)
    const msg = res?.message
    if (msg?.message_id) {
      setMails((list) => (list.some((m) => m.message_id === msg.message_id) ? list : [msg, ...list].slice(0, KEEP_MAILS)))
    }
    if (res?.found && res.code) {
      clearTimeout(timerRef.current)
      setPhase('found')
      onCodeRef.current?.(email, res)
    }
    return res
  }, [email])

  // 排下一次自动检查。只在「等待中且页面在前台」时排；到点前状态变了（找到码 / 卸载 / 进后台）就不会再查。
  const schedule = useCallback(() => {
    clearTimeout(timerRef.current)
    if (!aliveRef.current || phaseRef.current === 'found' || phaseRef.current === 'timeout') return
    if (document.hidden) {
      setPhase('paused')
      return
    }
    const start = startRef.current
    const end = start + WINDOW_MS
    if (Date.now() >= end) {
      setPhase('timeout')
      return
    }
    const last = lastRef.current || start
    const gap = !lastRef.current ? FIRST_MS : last - start < FAST_FOR_MS ? FAST_MS : SLOW_MS
    const at = last + gap
    if (at > end) {
      // 窗口里排不下下一次了：到 5 分钟整点时标记为「已停止」
      timerRef.current = setTimeout(() => aliveRef.current && setPhase((p) => (p === 'found' ? p : 'timeout')), Math.max(0, end - Date.now()))
      return
    }
    timerRef.current = setTimeout(async () => {
      if (!aliveRef.current || document.hidden || phaseRef.current === 'found') return
      if (Date.now() >= end) {
        setPhase('timeout')
        return
      }
      const res = await check()
      if (res && !(res.found && res.code)) schedule()
    }, Math.max(0, at - Date.now()))
  }, [check])

  useEffect(() => {
    aliveRef.current = true
    schedule()
    const onVis = () => {
      if (phaseRef.current === 'found' || phaseRef.current === 'timeout') return
      if (document.hidden) {
        clearTimeout(timerRef.current)
        setPhase('paused')
      } else {
        setPhase('watching')
        phaseRef.current = 'watching'
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      aliveRef.current = false
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [schedule])

  // 「再查一次」：只查这一次；自动检查还在进行时，下一次从这次往后排
  const checkNow = async () => {
    const res = await check()
    if (res && !(res.found && res.code) && phaseRef.current === 'watching') schedule()
  }

  if (openMail) {
    return (
      <div className="mh-acd">
        <button type="button" className="mh-linkbtn mh-acd__back" onClick={() => setOpenMail(null)}>
          <ArrowLeft size={14} aria-hidden />
          {t('dm.watch.back')}
        </button>
        <MailDetail key={openMail.message_id} target={{ source: 'domain', id: openMail.message_id }} preview={{ ...openMail, mailbox: email }} />
      </div>
    )
  }

  const found = result?.found && result.code
  const latest = result?.message
  let statusIcon = null
  let statusText = ''
  if (phase === 'paused') {
    statusIcon = <PauseCircle size={15} aria-hidden />
    statusText = t('dm.watch.paused')
  } else if (phase === 'timeout') {
    statusIcon = <TimerOff size={15} aria-hidden />
    statusText = t('dm.watch.timeout')
  } else if (phase === 'watching') {
    statusText = t('dm.watch.waitingHint')
  }

  return (
    <div className="mh-acd mh-watch" data-checks={countRef.current} data-phase={phase}>
      <section className="mh-acd__head">
        <CopyAddr email={email} className="mh-addr--lg" />
        <p className="mh-watch__lead">{t('dm.watch.created')}</p>
      </section>

      <div className="mh-acd__code mh-watch__box" role="status" aria-live="polite">
        {found ? (
          <>
            <span className="mh-detail__code-label">
              <KeyRound size={13} aria-hidden />
              {t('md.code')}
            </span>
            <CodeChip code={result.code} size="lg" />
            {latest?.subject && <span className="mh-acd__code-sub">{latest.subject}</span>}
            <span className="mh-acd__code-sub">{t('dm.watch.found')}</span>
          </>
        ) : (
          <>
            <span className="mh-watch__waiting">
              {phase === 'watching' || checking ? <span className="mh-light" aria-hidden /> : null}
              {latest ? t('dm.watch.noCodeYet') : t('dm.watch.waiting')}
            </span>
            {statusText && (
              <span className="mh-acd__code-sub mh-watch__hint">
                {statusIcon}
                {statusText}
              </span>
            )}
          </>
        )}
        {result?.error && !found && (
          <span className="mh-watch__err">
            <AlertTriangle size={13} aria-hidden />
            {result.error}
          </span>
        )}
        {lastAt > 0 && <span className="mh-watch__last">{t('dm.watch.lastCheck', { time: clock(lastAt) })}</span>}
      </div>

      <div className="mh-acd__actions">
        <ActBtn icon={RotateCcw} label={t('dm.watch.checkNow')} showLabel tone="primary" busy={checking} onClick={checkNow} />
        <ActBtn icon={Inbox} label={t('dom.viewMails')} showLabel to={`/?q=${encodeURIComponent(email)}`} />
      </div>

      <section className="mh-acd__mails" aria-labelledby="mh-watch-mails">
        <header className="mh-acd__mails-head">
          <h3 id="mh-watch-mails" className="mh-h3">
            {t('dm.watch.mails')}
          </h3>
        </header>
        {mails.length === 0 ? (
          <p className="mh-acd__empty">{t('dm.watch.mailsEmpty')}</p>
        ) : (
          <ul className="mh-mlist">
            {mails.map((m) => (
              <li key={m.message_id} className="mh-mlist__row">
                <button type="button" className="mh-mlist__open" onClick={() => setOpenMail(m)}>
                  <span className="mh-mlist__icon" aria-hidden>
                    <Mail size={14} />
                  </span>
                  <span className="mh-mlist__main">
                    <span className="mh-mlist__subject">{m.subject || t('common.noSubject')}</span>
                    <span className="mh-mlist__from">{m.from_name || m.from_address || t('common.none')}</span>
                  </span>
                  <time className="mh-mlist__time" dateTime={m.received_at || undefined} title={fmtDateTime(m.received_at) || ''}>
                    {m.received_at ? fmtRelative(m.received_at, locale, now) : ''}
                  </time>
                </button>
                {m.code && (
                  <span className="mh-mlist__code">
                    <CodeChip code={m.code} size="sm" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

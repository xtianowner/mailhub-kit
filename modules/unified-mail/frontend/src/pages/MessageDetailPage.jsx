import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Cloud, Mailbox, Reply } from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { fmtDateTime } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { MailDetailView } from '../components/overview/MailDetail.jsx'
import { ComposeMailDialog } from '../components/ComposeMailDialog.jsx'
import { StatusPill } from '../components/work.jsx'

function replySubject(subject) {
  const value = String(subject || '').trim()
  if (!value) return 'Re:'
  return /^re:/i.test(value) ? value : `Re: ${value}`
}

// 统一邮件详情页：两个来源同一个页面，内容结构与统一总览抽屉里的详情完全一致（同一个 MailDetailView）。
// 有验证码就大号摆在最上面（接码是高频动作），没有也照样把整封信摊开 —— 这个工具不只用来接码。
// 页面独有：返回、来源标记、域名邮件可「回复」。
export default function MessageDetailPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const { source, id } = useParams()
  const [params] = useSearchParams()
  const accountId = params.get('account_id')

  const [msg, setMsg] = useState(null)
  const [state, setState] = useState('loading')
  const [replyOpen, setReplyOpen] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      setMsg(
        await hubApi.message({
          source,
          id: decodeURIComponent(id),
          account_id: accountId || undefined,
        }),
      )
      setState('ready')
    } catch {
      setState('error')
    }
  }, [source, id, accountId])

  useEffect(() => {
    load()
  }, [load])

  const m = msg || {}
  const isHot = (msg?.source || source) === 'hotmail'
  const meta = [
    [t('md.from'), m.from_name ? `${m.from_name} <${m.from_address || ''}>` : m.from_address],
    [t('md.to'), m.mailbox],
    [t('md.time'), m.received_at ? fmtDateTime(m.received_at) : null],
  ]

  return (
    <div className="mh-page mh-msgpage">
      <div className="mh-msgbar">
        <button type="button" className="mh-btn mh-btn--quiet mh-btn--sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} aria-hidden />
          {t('md.back')}
        </button>
        <span className="mh-msgbar__end">
          <StatusPill tone={isHot ? 'info' : 'ok'} dot={false}>
            {isHot ? <Mailbox size={11} aria-hidden /> : <Cloud size={11} aria-hidden />}
            {t(isHot ? 'src.hotmail' : 'src.domain')}
          </StatusPill>
          {state === 'ready' && msg?.source === 'domain' && msg.mailbox && msg.from_address && (
            <button type="button" className="mh-btn mh-btn--ghost mh-btn--sm" onClick={() => setReplyOpen(true)}>
              <Reply size={14} aria-hidden />
              {t('compose.reply')}
            </button>
          )}
        </span>
      </div>

      <article className="mh-card mh-msgcard">
        <MailDetailView m={m} state={state} full={msg} meta={meta} onRetry={load} subjectAs="h1" pendingSubject />
      </article>

      {msg && (
        <ComposeMailDialog
          open={replyOpen}
          onClose={() => setReplyOpen(false)}
          mode="reply"
          initialValues={{
            from_address: msg.mailbox || '',
            to: msg.from_address || '',
            subject: replySubject(msg.subject),
            reply_to_message_id: msg.message_id || '',
          }}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Mailbox, RotateCw } from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDateTime } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { MailDetailView } from '../components/overview/MailDetail.jsx'
import { MailBody } from '../components/MailBody.jsx'
import { StatusPill } from '../components/work.jsx'

// Hotmail 账号下的单封邮件（/hotmail/accounts/:id/messages/:mid，旧链接保留）。
// 呈现与统一邮件详情一致（同一个 MailDetailView）；数据仍来自 hotmail-graph 的缓存，
// 正文只有纯文本缓存，交给 MailBody 的纯文本视图（React 文本节点，不解析 HTML）。保留「重新提取」。
export default function MessagePage() {
  const { id, mid } = useParams()
  const { t } = useLocale()
  const toast = useToast()

  const [msg, setMsg] = useState(null)
  const [state, setState] = useState('loading') // loading|ready|error|notfound|cred
  const [reBusy, setReBusy] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      setMsg(await api.message(id, mid))
      setState('ready')
    } catch (e) {
      if (e.status === 409) setState('cred')
      else if (e.status === 404) setState('notfound')
      else setState('error')
    }
  }, [id, mid])

  useEffect(() => {
    load()
  }, [load])

  const onReextract = async () => {
    setReBusy(true)
    try {
      setMsg(await api.reextract(id, mid))
      toast.success(`${t('msg.reextract')} ✓`)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setReBusy(false)
    }
  }

  const m = msg || {}
  const isJunk = m.folder_name === 'junkemail'
  const meta = [
    [t('md.from'), m.from_name && m.from_address ? `${m.from_name} <${m.from_address}>` : m.from_name || m.from_address],
    [t('md.time'), m.received_at ? fmtDateTime(m.received_at) : null],
    [t('hm.msg.folder'), msg ? t(isJunk ? 'folder.junk' : 'folder.inbox') : null],
  ]
  const errorText = state === 'cred' ? t('msg.credInvalid') : state === 'notfound' ? t('msg.notFound') : t('common.error')

  return (
    <div className="mh-page mh-msgpage">
      <div className="mh-msgbar">
        <Link to={`/hotmail/accounts/${id}`} className="mh-btn mh-btn--quiet mh-btn--sm">
          <ArrowLeft size={15} aria-hidden />
          {t('msg.back')}
        </Link>
        <span className="mh-msgbar__end">
          <StatusPill tone={isJunk ? 'warn' : 'info'} dot={false}>
            {isJunk ? <AlertTriangle size={11} aria-hidden /> : <Mailbox size={11} aria-hidden />}
            {t(isJunk ? 'folder.junk' : 'src.hotmail')}
          </StatusPill>
          {state === 'ready' && (
            <button type="button" className="mh-btn mh-btn--ghost mh-btn--sm" onClick={onReextract} disabled={reBusy}>
              <RotateCw size={14} className={reBusy ? 'mh-spin' : ''} aria-hidden />
              {t('msg.reextract')}
            </button>
          )}
        </span>
      </div>

      <article className="mh-card mh-msgcard">
        <MailDetailView
          m={{ subject: m.subject, code: m.verification_code }}
          state={state === 'ready' ? 'ready' : state === 'loading' ? 'loading' : 'error'}
          full={msg ? { links: msg.links || [] } : null}
          meta={meta}
          tags={msg?.tags}
          onRetry={state === 'error' ? load : undefined}
          errorText={errorText}
          subjectAs="h1"
          pendingSubject
          maxLinks={Infinity}
          body={<MailBody messageKey={`${id}:${mid}`} text={msg?.body_text_cached || ''} />}
        />
      </article>
    </div>
  )
}

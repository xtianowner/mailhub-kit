import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, KeyRound, Reply } from 'lucide-react'
import { hubApi } from '../lib/hubApi.js'
import { fmtDateTime } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { Card, Button, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'
import { MailBody } from '../components/MailBody.jsx'
import { SourceBadge } from '../components/hub.jsx'
import { ComposeMailDialog } from '../components/ComposeMailDialog.jsx'

function replySubject(subject) {
  const value = String(subject || '').trim()
  if (!value) return 'Re:'
  return /^re:/i.test(value) ? value : `Re: ${value}`
}

// 统一邮件详情：两个来源同一个页面。
// 有验证码就大号摆在最上面（接码是高频动作），没有也照样把整封信摊开 ——
// 这个工具不只用来接码。
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

  if (state === 'loading') return <StateBlock state="loading" />
  if (state === 'error' || !msg) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="md" className="self-start" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} />
          {t('md.back')}
        </Button>
        <StateBlock state="error" message={t('md.notFound')} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Button variant="ghost" size="md" className="self-start" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} />
        {t('md.back')}
      </Button>

      {/* 有码就顶在最前面，一眼可见、一点即复制 */}
      {msg.code ? (
        <Card className="flex flex-col items-center gap-2 border-accent/25 bg-accent/5 px-4 py-5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
            <KeyRound size={13} aria-hidden />
            {t('md.code')}
          </span>
          <CopyCode code={msg.code} size="lg" />
          <span className="text-xs text-subtle">{t('code.clickToCopy')}</span>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 font-heading text-lg font-semibold text-text sm:text-xl">
            {msg.subject || <span className="text-subtle">（无主题）</span>}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {msg.source === 'domain' && msg.mailbox && msg.from_address && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setReplyOpen(true)}>
                <Reply size={13} aria-hidden />
                {t('compose.reply')}
              </Button>
            )}
            <SourceBadge source={msg.source} />
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 border-t border-border/50 pt-3 text-xs sm:grid-cols-2">
          {[
            [t('md.from'), msg.from_name ? `${msg.from_name} <${msg.from_address || ''}>` : msg.from_address],
            [t('md.to'), msg.mailbox],
            [t('md.time'), msg.received_at ? fmtDateTime(msg.received_at) : null],
            // 有码时上面已有大号卡片，这里不再重复；没码时才明确告知「没提取到」
            [t('inbox.col.code'), msg.code ? null : t('md.code.none')],
          ].map(([label, value]) =>
            value ? (
              <div key={label} className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-subtle">{label}</dt>
                <dd className="min-w-0 break-all text-muted">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>

        {msg.links?.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border/50 pt-3">
            <span className="text-xs text-subtle">{t('md.links')}</span>
            {msg.links.slice(0, 8).map((l) => (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 truncate font-mono text-xs text-accent transition-colors duration-fast hover:text-accent-hover"
                title={l}
              >
                <ExternalLink size={11} className="shrink-0" aria-hidden />
                <span className="truncate">{l}</span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card className="px-4 py-4 sm:px-5">
        <h2 className="mb-3 font-heading text-sm font-semibold text-text">{t('md.body')}</h2>
        <MailBody
          messageKey={msg.message_id}
          html={msg.html_body}
          text={msg.text_body || msg.preview}
          inlineImages={msg.inline_images}
        />
      </Card>

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
    </div>
  )
}

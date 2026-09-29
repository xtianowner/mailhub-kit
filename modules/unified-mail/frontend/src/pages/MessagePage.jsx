import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, RotateCw, ExternalLink, Mail, MailWarning } from 'lucide-react'
import { api } from '../lib/api.js'
import { fmtDateTime } from '../lib/format.js'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { useToast } from '../lib/toast.jsx'
import { Button, Badge, Card, CopyCode } from '../components/ui.jsx'
import { StateBlock } from '../components/StateBlock.jsx'

export default function MessagePage() {
  const { id, mid } = useParams()
  const navigate = useNavigate()
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
      toast.success(t('msg.reextract') + ' ✓')
    } catch {
      toast.error(t('common.error'))
    } finally {
      setReBusy(false)
    }
  }

  const back = (
    <Link
      to={`/hotmail/accounts/${id}`}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-colors hover:text-text"
    >
      <ArrowLeft size={15} /> {t('msg.back')}
    </Link>
  )

  if (state === 'loading') return <StateBlock state="loading" />
  if (state === 'notfound')
    return (
      <div className="flex flex-col gap-4">
        {back}
        <StateBlock state="empty" message={t('msg.notFound')} />
      </div>
    )
  if (state === 'cred')
    return (
      <div className="flex flex-col gap-4">
        {back}
        <StateBlock state="error" message={t('msg.credInvalid')} />
      </div>
    )
  if (state === 'error' || !msg)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <StateBlock state="error" onRetry={load} />
      </div>
    )

  const isJunk = msg.folder_name === 'junkemail'

  return (
    <div className="flex flex-col gap-5">
      {back}

      {/* header */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {isJunk ? (
            <Badge tone="warning">
              <MailWarning size={12} /> {t('folder.junk')}
            </Badge>
          ) : (
            <Badge tone="info">
              <Mail size={12} /> {t('folder.inbox')}
            </Badge>
          )}
          <h1 className="break-words font-heading text-lg font-semibold text-text">
            {msg.subject || '(no subject)'}
          </h1>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>
            {t('msg.from')}:{' '}
            <span className="text-text">{msg.from_name || msg.from_address || t('common.none')}</span>
            {msg.from_name && msg.from_address && (
              <span className="ml-1.5 text-subtle">&lt;{msg.from_address}&gt;</span>
            )}
          </span>
          <span>
            {t('msg.time')}:{' '}
            <span className="text-text">
              {msg.received_at ? fmtDateTime(msg.received_at) : t('common.none')}
            </span>
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(260px,320px)]">
        {/* body */}
        <Card className="flex flex-col p-0">
          <div className="border-b border-border/70 px-5 py-3 font-heading text-sm font-semibold text-text">
            {t('msg.body')}
          </div>
          {msg.body_text_cached ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-relaxed text-muted">
              {msg.body_text_cached}
            </pre>
          ) : (
            <div className="px-5 py-8 text-sm text-subtle">{t('msg.body.empty')}</div>
          )}
        </Card>

        {/* extract */}
        <Card className="flex h-fit flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <span className="font-heading text-sm font-semibold text-text">{t('msg.extract')}</span>
            <Button size="sm" variant="subtle" loading={reBusy} onClick={onReextract}>
              {!reBusy && <RotateCw size={13} />}
              {t('msg.reextract')}
            </Button>
          </div>

          {/* code */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-subtle">{t('msg.extract.code')}</span>
            {msg.verification_code ? (
              <CopyCode code={msg.verification_code} size="lg" className="self-start" />
            ) : (
              <span className="text-sm text-subtle">{t('common.none')}</span>
            )}
          </div>

          {/* links */}
          {msg.links?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-subtle">{t('msg.extract.links')}</span>
              {msg.links.map((l, i) => (
                <a
                  key={i}
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 truncate text-sm text-accent hover:underline"
                >
                  <ExternalLink size={13} className="shrink-0" />
                  <span className="truncate">{l}</span>
                </a>
              ))}
            </div>
          )}

          {/* tags */}
          {msg.tags?.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-subtle">{t('msg.extract.tags')}</span>
              <div className="flex flex-wrap gap-1.5">
                {msg.tags.map((tag, i) => (
                  <Badge key={i} tone="subtle">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {!msg.verification_code && !msg.links?.length && !msg.tags?.length && (
            <span className="text-sm text-subtle">{t('msg.extract.none')}</span>
          )}
        </Card>
      </div>
    </div>
  )
}

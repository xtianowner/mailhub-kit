import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowUpRight, ExternalLink, KeyRound, Mail, MailWarning, RotateCcw, RotateCw, StickyNote, Tags } from 'lucide-react'
import { api } from '../../lib/api.js'
import { fmtDate, fmtDateTime, fmtRelative } from '../../lib/format.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { EnvelopeSkeleton } from '../EnvelopeSkeleton.jsx'
import { CodeChip } from '../overview/CodeChip.jsx'
import { MailDetail } from '../overview/MailDetail.jsx'
import { AccountStatus, ActBtn, CodeCell, CopyAddr, StatusPill } from '../work.jsx'

/* Hotmail 账号详情（右侧抽屉里）：账号信息 → 接码 / 刷新 / 进入完整页 → 最近邮件。
   点一封邮件在抽屉里看详情（和统一总览同一个 MailDetail），「返回账号」回到列表。
   邮件列表只在打开抽屉时取一次、点「刷新邮件」时再取；抽屉里不做定时轮询（自动刷新留在完整账号页）。
   接码 / 刷新复用列表页的同一套处理函数，所以抽屉和表格里的结果始终一致。 */
export function AccountDrawer({ accountId, preview, busy, codeRes, onCode, onRefresh, now }) {
  const { t, locale } = useLocale()
  const [acc, setAcc] = useState(preview || null)
  const [accState, setAccState] = useState(preview ? 'ready' : 'loading')
  const [mails, setMails] = useState([])
  const [mailState, setMailState] = useState('loading')
  const [openMail, setOpenMail] = useState(null)

  // 列表里那一行更新了（刷新 / 接码之后）→ 抽屉同步
  useEffect(() => {
    if (preview) {
      setAcc(preview)
      setAccState('ready')
    }
  }, [preview])

  // 深链进来、列表里还没有这一行时，单独取一次账号
  useEffect(() => {
    if (preview) return undefined
    let cancelled = false
    setAccState('loading')
    api
      .account(accountId)
      .then((a) => {
        if (cancelled) return
        setAcc(a)
        setAccState('ready')
      })
      .catch((e) => !cancelled && setAccState(e?.status === 404 ? 'notfound' : 'error'))
    return () => {
      cancelled = true
    }
    // preview 只在首次决定要不要单独取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const loadMails = useCallback(async () => {
    setMailState('loading')
    try {
      const res = await api.messages(accountId, 20)
      const list = (res.messages || []).slice().sort((a, b) => (Date.parse(b.received_at || '') || 0) - (Date.parse(a.received_at || '') || 0))
      setMails(list)
      setMailState(res.dead ? 'dead' : 'ready')
    } catch {
      setMailState('error')
    }
  }, [accountId])

  useEffect(() => {
    setOpenMail(null)
    loadMails()
  }, [loadMails])

  if (accState === 'loading') return <EnvelopeSkeleton rows={4} label={t('common.loading')} />
  if (accState !== 'ready' || !acc) {
    return (
      <p className="mh-detail__error" role="alert">
        <AlertTriangle size={15} aria-hidden />
        <span>{t(accState === 'notfound' ? 'account.notFound' : 'common.error')}</span>
      </p>
    )
  }

  if (openMail) {
    return (
      <div className="mh-acd">
        <button type="button" className="mh-linkbtn mh-acd__back" onClick={() => setOpenMail(null)}>
          <ArrowLeft size={14} aria-hidden />
          {t('hm.drawer.backToAccount')}
        </button>
        <MailDetail
          key={openMail.graph_message_id}
          target={{ source: 'hotmail', id: openMail.graph_message_id, account_id: String(acc.id) }}
          preview={{
            subject: openMail.subject,
            code: openMail.verification_code,
            from_name: openMail.from_name,
            from_address: openMail.from_address,
            mailbox: acc.email,
            received_at: openMail.received_at,
          }}
        />
      </div>
    )
  }

  const dead = acc.status === 'dead'
  const fetched = codeRes && codeRes.found ? codeRes.code : null
  const stale = !fetched && acc.code_fresh === false && !!acc.last_code
  const rt =
    acc.rt_days_left === null || acc.rt_days_left === undefined
      ? t('table.never')
      : acc.rt_days_left < 0
        ? t('table.expired')
        : `${acc.rt_days_left} ${t('table.days')}`

  return (
    <div className="mh-acd">
      <section className="mh-acd__head">
        <CopyAddr email={acc.email} className="mh-addr--lg" />
        <div className="mh-acd__badges">
          <AccountStatus acc={acc} />
          {acc.alias_count > 1 && (
            <StatusPill tone="info" dot={false}>
              <Tags size={11} aria-hidden />
              {t('table.aliasBadge', { n: acc.alias_count })}
            </StatusPill>
          )}
          {acc.group_name && <span className="mh-chip">{acc.group_name}</span>}
        </div>
        {acc.note && (
          <p className="mh-acd__note">
            <StickyNote size={13} aria-hidden />
            <span>{acc.note}</span>
          </p>
        )}
        {dead && (
          <p className="mh-banner mh-banner--danger" role="status">
            <AlertTriangle size={15} aria-hidden />
            <span>{t('account.deadBanner')}</span>
          </p>
        )}
      </section>

      <dl className="mh-facts">
        <div>
          <dt>{t('account.rtExpires')}</dt>
          <dd>
            {rt}
            {acc.rt_expires_at && <span className="mh-facts__sub">{fmtDate(acc.rt_expires_at)}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('account.lastRefresh')}</dt>
          <dd>{acc.last_refresh_at ? fmtDateTime(acc.last_refresh_at) : t('common.none')}</dd>
        </div>
        <div>
          <dt>{t('hm.col.lastMail')}</dt>
          <dd title={fmtDateTime(acc.last_mail_at) || ''}>{acc.last_mail_at ? fmtRelative(acc.last_mail_at, locale, now) : t('common.none')}</dd>
        </div>
        <div>
          <dt>{t('table.lastCode')}</dt>
          <dd>
            <CodeCell
              code={fetched || acc.last_code}
              stale={stale}
              staleTitle={stale ? t('code.history.hint', { ago: acc.last_code_at ? fmtRelative(acc.last_code_at, locale, now) : '' }) : undefined}
            />
          </dd>
        </div>
      </dl>

      <div className="mh-acd__actions">
        <ActBtn icon={KeyRound} label={t('action.code')} showLabel tone="primary" busy={busy === 'code'} disabled={dead} onClick={() => onCode(acc)} />
        <ActBtn icon={RotateCw} label={t('action.refresh')} showLabel busy={busy === 'refresh'} onClick={() => onRefresh(acc)} />
        <ActBtn icon={ArrowUpRight} label={t('hm.drawer.openFull')} showLabel to={`/hotmail/accounts/${acc.id}`} />
      </div>

      {codeRes && (
        <div className="mh-acd__code" role="status">
          {codeRes.found && codeRes.code ? (
            <>
              <CodeChip code={codeRes.code} size="lg" />
              {codeRes.message?.subject && <span className="mh-acd__code-sub">{codeRes.message.subject}</span>}
            </>
          ) : (
            <span className="mh-acd__code-sub">{codeRes.dead ? t('account.deadBanner') : t('account.code.none')}</span>
          )}
          {codeRes.links?.length > 0 && (
            <span className="mh-acd__links">
              {codeRes.links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noreferrer noopener" title={l}>
                  <ExternalLink size={12} aria-hidden />
                  <span>{l}</span>
                </a>
              ))}
            </span>
          )}
        </div>
      )}

      <section className="mh-acd__mails" aria-labelledby="mh-acd-mails">
        <header className="mh-acd__mails-head">
          <h3 id="mh-acd-mails" className="mh-h3">
            {t('account.mails')}
          </h3>
          <ActBtn icon={RotateCcw} label={t('account.mails.refresh')} busy={mailState === 'loading'} onClick={loadMails} />
        </header>
        {mailState === 'loading' && <EnvelopeSkeleton rows={3} label={t('common.loading')} />}
        {mailState === 'error' && (
          <p className="mh-detail__error" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <span>{t('common.error')}</span>
            <button type="button" className="mh-linkbtn" onClick={loadMails}>
              {t('common.retry')}
            </button>
          </p>
        )}
        {mailState === 'dead' && <p className="mh-acd__empty">{t('account.deadBanner')}</p>}
        {mailState === 'ready' && mails.length === 0 && <p className="mh-acd__empty">{t('account.mails.empty')}</p>}
        {mailState === 'ready' && mails.length > 0 && (
          <ul className="mh-mlist">
            {mails.map((m) => (
              <li key={m.graph_message_id} className="mh-mlist__row">
                <button type="button" className="mh-mlist__open" onClick={() => setOpenMail(m)}>
                  <span className="mh-mlist__icon" aria-hidden>
                    {m.folder_name === 'junkemail' ? <MailWarning size={14} /> : <Mail size={14} />}
                  </span>
                  <span className="mh-mlist__main">
                    <span className="mh-mlist__subject">{m.subject || t('common.noSubject')}</span>
                    <span className="mh-mlist__from">
                      {m.folder_name === 'junkemail' && <span className="mh-mlist__junk">{t('folder.junk')}</span>}
                      {m.from_name || m.from_address || t('common.none')}
                    </span>
                  </span>
                  <time className="mh-mlist__time" dateTime={m.received_at || undefined} title={fmtDateTime(m.received_at) || ''}>
                    {m.received_at ? fmtRelative(m.received_at, locale, now) : ''}
                  </time>
                </button>
                {m.verification_code && (
                  <span className="mh-mlist__code">
                    <CodeChip code={m.verification_code} size="sm" />
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

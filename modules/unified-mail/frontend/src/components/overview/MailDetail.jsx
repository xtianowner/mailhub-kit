import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink, KeyRound, Maximize2, RotateCcw } from 'lucide-react'
import { hubApi } from '../../lib/hubApi.js'
import { fmtDateTime } from '../../lib/format.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { MailBody } from '../MailBody.jsx'
import { CodeChip } from './CodeChip.jsx'

/** 邮件详情的呈现（抽屉和独立详情页共用同一套结构）：验证码 → 主题 → 发件 / 收件 / 时间 → 链接 → 正文。
 *  正文渲染一律交给 MailBody（沙箱 iframe + 默认屏蔽远程图片），这里不写任何 HTML 渲染逻辑。
 *  m：已知的信息（列表行已有的主题、验证码等，先显示）；full：取回的完整邮件；
 *  body：可选，自定义正文节点（Hotmail 旧详情页只有纯文本缓存）；children：底部附加内容。 */
export function MailDetailView({ m, state, full, meta, onRetry, errorText, subjectAs: Subject = 'p', tags, body, maxLinks = 8, pendingSubject = false, children }) {
  const { t } = useLocale()
  const code = m.code
  const links = full?.links || []
  return (
    <div className="mh-detail">
      {code ? (
        <div className="mh-detail__code">
          <span className="mh-detail__code-label">
            <KeyRound size={13} aria-hidden />
            {t('md.code')}
          </span>
          <CodeChip code={code} size="lg" />
        </div>
      ) : null}

      {/* pendingSubject（独立详情页）：主题还没取到时不先写「（无主题）」，加载中给一条占位、出错时不显示 */}
      {pendingSubject && !m.subject && state !== 'ready' ? (
        state === 'loading' ? (
          <span className="mh-skel__bar mh-detail__subject-skel" aria-hidden />
        ) : null
      ) : (
        <Subject className="mh-detail__subject">{m.subject || t('common.noSubject')}</Subject>
      )}

      <dl className="mh-detail__meta">
        {meta.map(([label, value]) =>
          value ? (
            <div key={label} className="mh-detail__meta-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ) : null,
        )}
        {state === 'ready' && !code && (
          <div className="mh-detail__meta-row">
            <dt>{t('md.code')}</dt>
            <dd>{t('md.code.none')}</dd>
          </div>
        )}
      </dl>

      {links.length > 0 && (
        <div className="mh-detail__links">
          <span className="mh-detail__section">{t('md.links')}</span>
          {links.slice(0, maxLinks).map((l) => (
            <a key={l} href={l} target="_blank" rel="noreferrer noopener" title={l}>
              <ExternalLink size={12} aria-hidden />
              <span>{l}</span>
            </a>
          ))}
        </div>
      )}

      {tags?.length > 0 && (
        <div className="mh-detail__tags">
          <span className="mh-detail__section">{t('msg.extract.tags')}</span>
          <span className="mh-detail__tag-list">
            {tags.map((tag) => (
              <span key={tag} className="mh-chip">
                {tag}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="mh-detail__body">
        <span className="mh-detail__section">{t('md.body')}</span>
        {state === 'loading' && (
          <div className="mh-detail__loading" role="status" aria-live="polite">
            <span className="sr-only">{t('common.loading')}</span>
            <span className="mh-skel__bar" style={{ width: '82%' }} aria-hidden />
            <span className="mh-skel__bar" style={{ width: '64%' }} aria-hidden />
            <span className="mh-skel__bar" style={{ width: '74%' }} aria-hidden />
          </div>
        )}
        {state === 'error' && (
          <p className="mh-detail__error" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <span>{errorText || t('md.notFound')}</span>
            {onRetry && (
              <button type="button" className="mh-linkbtn" onClick={onRetry}>
                <RotateCcw size={13} aria-hidden />
                {t('common.retry')}
              </button>
            )}
          </p>
        )}
        {state === 'ready' &&
          full &&
          (body || (
            <MailBody
              messageKey={full.message_id}
              html={full.html_body}
              text={full.text_body || full.preview}
              inlineImages={full.inline_images}
            />
          ))}
      </div>

      {children}
    </div>
  )
}

/** 一封邮件的独立详情页地址（抽屉底部「完整页面」与抽屉顶部「在新页面打开」共用） */
export function messageHref(target) {
  return `/message/${target.source}/${encodeURIComponent(target.id)}${
    target.source === 'hotmail' && target.account_id ? `?account_id=${target.account_id}` : ''
  }`
}

/** 抽屉里的邮件详情。列表行已有的信息（主题、验证码、收件地址）立即显示，正文随后取回。 */
export function MailDetail({ target, preview }) {
  const { t } = useLocale()
  const [msg, setMsg] = useState(null)
  const [state, setState] = useState('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      setMsg(await hubApi.message({ source: target.source, id: target.id, account_id: target.account_id || undefined }))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [target.source, target.id, target.account_id])

  useEffect(() => {
    setMsg(null)
    load()
  }, [load])

  const m = msg || preview || {}
  const fullHref = messageHref(target)
  const meta = [
    [t('md.from'), m.from_name ? `${m.from_name} <${m.from_address || ''}>` : m.from_address],
    [t('md.to'), m.mailbox],
    [t('md.time'), m.received_at ? fmtDateTime(m.received_at) : null],
    [t('inbox.col.source'), t(target.source === 'hotmail' ? 'src.hotmail' : 'src.domain')],
  ]

  return (
    <MailDetailView m={m} state={state} full={msg} meta={meta} onRetry={load}>
      <Link to={fullHref} className="mh-detail__full">
        <Maximize2 size={14} aria-hidden />
        {t('drawer.openFull')}
      </Link>
    </MailDetailView>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useStoredBool } from '../../lib/motion.js'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { StatusLight } from './StatCard.jsx'

/** 邮箱信息区外壳（展示层）：可折叠，折叠状态记在 localStorage；折叠后只留一行摘要。
 *  lights: [{ key, label, tone: 'ok' | 'warn', status, title }] 上游链路状态 */
export function InfoPanel({ lights = [], summary, notice, onRefresh, refreshing, children }) {
  const { t } = useLocale()
  const [collapsed, setCollapsed] = useStoredBool('mailhub:info-collapsed', false)
  return (
    <section className={`mh-card mh-info ${collapsed ? 'is-collapsed' : ''}`} aria-labelledby="mh-info-title">
      <header className="mh-info__head">
        <h2 id="mh-info-title" className="mh-h2">
          {t('ov.info.title')}
        </h2>
        <span className="mh-info__lights">
          {lights.map((l) => (
            <span key={l.key} className={`mh-info__light ${l.tone === 'ok' ? '' : 'is-warn'}`} title={l.title}>
              <StatusLight tone={l.tone} label={`${l.long || l.label} · ${l.status}`} />
              <span className="mh-info__light-label" aria-hidden>
                {l.label}
              </span>
              <span className="mh-info__light-status" aria-hidden>
                {l.status}
              </span>
            </span>
          ))}
        </span>
        <button
          type="button"
          className="mh-icon-btn"
          onClick={onRefresh}
          aria-label={t('ov.info.refresh')}
          title={t('ov.info.refresh')}
          disabled={refreshing}
        >
          <RefreshCw size={16} className={refreshing ? 'mh-spin' : ''} />
        </button>
        <button
          type="button"
          className="mh-icon-btn mh-info__toggle"
          aria-expanded={!collapsed}
          aria-controls="mh-info-body"
          aria-label={collapsed ? t('ov.info.expand') : t('ov.info.collapse')}
          title={collapsed ? t('ov.info.expand') : t('ov.info.collapse')}
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronDown size={17} className={collapsed ? '' : 'is-flipped'} />
        </button>
      </header>
      {notice}
      <AnimatePresence initial={false} mode="wait">
        {collapsed ? (
          <motion.div
            key="sum"
            className="mh-info__summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {summary}
          </motion.div>
        ) : (
          <motion.div
            key="body"
            id="mh-info-body"
            className="mh-info__body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

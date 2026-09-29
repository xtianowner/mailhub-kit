import { Inbox, AlertTriangle } from 'lucide-react'
import { Spinner, Button } from './ui.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'

// Unified loading / empty / error placeholder for lists & pages.
export function StateBlock({ state, message, onRetry, className = '' }) {
  const { t } = useLocale()
  if (state === 'loading') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-16 text-muted ${className}`}>
        <Spinner size={22} />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-16 text-muted ${className}`}>
        <AlertTriangle size={22} className="text-danger" />
        <span className="text-sm">{message || t('common.error')}</span>
        {onRetry && (
          <Button size="sm" variant="subtle" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    )
  }
  // empty
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-subtle ${className}`}>
      <Inbox size={22} />
      <span className="text-sm">{message || t('table.empty')}</span>
    </div>
  )
}

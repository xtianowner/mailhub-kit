import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider.jsx'
import { EmptyState } from '../components/EmptyState.jsx'

/** 404（展示层）：品牌形象「举着信封找信」+ 明确的两个出口，不留白屏、不出英文报错 */
export default function NotFoundPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  return (
    <div className="mh-404">
      <span className="mh-404__code" aria-hidden>
        404
      </span>
      <h1 className="sr-only">{t('nf.title')}</h1>
      <EmptyState
        size="lg"
        pose="search"
        title={t('nf.title')}
        desc={t('nf.desc')}
        action={
          <>
            <Link to="/" className="mh-btn mh-btn--primary">
              <LayoutDashboard size={15} aria-hidden />
              {t('nf.home')}
            </Link>
            <button type="button" className="mh-btn mh-btn--ghost" onClick={() => navigate(-1)}>
              <ArrowLeft size={15} aria-hidden />
              {t('nf.back')}
            </button>
          </>
        }
      />
    </div>
  )
}

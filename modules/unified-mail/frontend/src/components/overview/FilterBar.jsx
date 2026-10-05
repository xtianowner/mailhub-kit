import { motion } from 'motion/react'
import { ChevronDown, FolderTree, KeyRound, RotateCcw } from 'lucide-react'
import { useLocale } from '../../i18n/LocaleProvider.jsx'
import { segKeyDown } from './segKeys.js'

const SRC = ['all', 'hotmail', 'domain']

/** 来源 / 分组 / 只看带验证码。三者和搜索一起作用，状态由页面落在 URL 上。
 *  groups: [{ name, count, sources: Set('hotmail' | 'domain') }]；showSource=false（云端没有 Hotmail）时不出现来源切换 */
export function FilterBar({ showSource, source, onSource, groups, group, onGroup, onlyCodes, onOnlyCodes, active, onReset }) {
  const { t } = useLocale()
  const visibleGroups = groups.filter((g) => source === 'all' || g.sources.has(source) || g.name === group)
  // 分组是两个来源的并集：同名分组筛选时两边一起生效，所以只列一次，放进「两边都有」这一组
  const has = (g, s) => g.sources.has(s)
  const buckets = [
    ['ov.filter.groupBoth', visibleGroups.filter((g) => has(g, 'hotmail') && has(g, 'domain'))],
    ['ov.filter.groupHotmail', visibleGroups.filter((g) => has(g, 'hotmail') && !has(g, 'domain'))],
    ['ov.filter.groupDomain', visibleGroups.filter((g) => !has(g, 'hotmail'))],
  ].filter(([, list]) => list.length > 0)
  const opt = (g) => (
    <option key={g.name} value={g.name}>
      {g.count != null ? `${g.name}（${g.count}）` : g.name}
    </option>
  )

  return (
    <div className="mh-filters">
      {showSource && (
        <div
          className="mh-seg"
          role="radiogroup"
          aria-label={t('ov.filter.source')}
          onKeyDown={(e) => segKeyDown(e, SRC, source, onSource)}
        >
          {SRC.map((s) => {
            const on = source === s
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                className={`mh-seg__btn ${on ? 'is-on' : ''}`}
                onClick={() => onSource(s)}
              >
                {on && (
                  <motion.span
                    layoutId="mh-src-pill"
                    className="mh-seg__pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                {s !== 'all' && <span className={`mh-dot mh-dot--${s}`} aria-hidden />}
                <span className="mh-seg__label">{t(s === 'all' ? 'ov.filter.all' : `src.${s}`)}</span>
              </button>
            )
          })}
        </div>
      )}

      <label className={`mh-select ${group ? 'is-on' : ''}`}>
        <FolderTree size={14} aria-hidden />
        <span className="sr-only">{t('ov.filter.group')}</span>
        <select value={group} onChange={(e) => onGroup(e.target.value)}>
          <option value="">{t('group.all')}</option>
          {showSource && buckets.length > 1
            ? buckets.map(([key, list]) => (
                <optgroup key={key} label={t(key)}>
                  {list.map(opt)}
                </optgroup>
              ))
            : visibleGroups.map(opt)}
        </select>
        <ChevronDown size={14} className="mh-select__chev" aria-hidden />
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={onlyCodes}
        className={`mh-switch ${onlyCodes ? 'is-on' : ''}`}
        onClick={() => onOnlyCodes(!onlyCodes)}
      >
        <span className="mh-switch__track" aria-hidden>
          <span className="mh-switch__thumb" />
        </span>
        <KeyRound size={14} aria-hidden />
        {t('inbox.onlyCodes')}
      </button>

      {active && (
        <button type="button" className="mh-linkbtn" onClick={onReset}>
          <RotateCcw size={13} aria-hidden />
          {t('ov.filter.reset')}
        </button>
      )}
    </div>
  )
}

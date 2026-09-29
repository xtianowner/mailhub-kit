import { useCallback } from 'react'
import { useToast } from './toast.jsx'
import { useLocale } from '../i18n/LocaleProvider.jsx'

// Single source of click-to-copy used across every code display (overview row,
// code result, message extract). Falls back to a hidden textarea when the async
// Clipboard API is unavailable (insecure context / older browsers).
async function writeClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// useCopy(text, opts?) — copies text and shows a toast.
//   opts.successMsg: override the default "已复制" success toast (e.g. "已复制 1234").
//   opts.silent:     copy without any toast (caller shows its own feedback).
// Returns true/false so callers can branch on success.
export function useCopy() {
  const toast = useToast()
  const { t } = useLocale()
  return useCallback(
    async (text, opts = {}) => {
      if (text === null || text === undefined || text === '') return false
      const ok = await writeClipboard(String(text))
      if (opts.silent) return ok
      if (ok) toast.success(opts.successMsg || t('common.copied'))
      else toast.error(t('common.error'))
      return ok
    },
    [toast, t],
  )
}

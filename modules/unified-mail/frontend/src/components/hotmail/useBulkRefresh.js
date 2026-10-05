import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { useToast } from '../../lib/toast.jsx'
import { useLocale } from '../../i18n/LocaleProvider.jsx'

/* 批量刷新（刷新全部 / 快过期 / 失效）：逻辑与改版前完全一致 ——
   只在批量任务进行中每 2 秒查一次进度，结束即停；进页面时若已有任务在跑，接着查。不新增任何轮询。 */
const POLL_MS = 2000

export function useBulkRefresh(onDone) {
  const { t } = useLocale()
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const pollRef = useRef(null)
  const startingRef = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPoll = useCallback(() => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.bulkStatus()
        setStatus(s)
        if (!s.running) {
          stopPoll()
          doneRef.current?.()
          toast.success(t('overview.bulk.done'))
        }
      } catch {
        stopPoll()
      }
    }, POLL_MS)
  }, [t, toast])

  useEffect(() => {
    let cancelled = false
    api
      .bulkStatus()
      .then((s) => {
        if (!cancelled && s.running) {
          setStatus(s)
          startPoll()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      stopPoll()
    }
    // 只在进页面时检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async (kind) => {
    if (startingRef.current || status?.running) return
    startingRef.current = true
    try {
      const res = await api.bulkRefresh(kind)
      if (res.started) {
        setStatus({ running: true, kind, total: res.total, done: 0, ok: 0, dead: 0, error: 0 })
        startPoll()
      } else {
        toast.info(res.reason || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      startingRef.current = false
    }
  }

  const running = !!status?.running
  const pct = status && status.total ? Math.round((status.done / status.total) * 100) : 0
  return { status, running, pct, start }
}

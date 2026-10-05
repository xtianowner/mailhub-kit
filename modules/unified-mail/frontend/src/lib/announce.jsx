import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/* 读屏播报（aria-live）：复制结果、新邮件到达这类「界面有变化但焦点没动」的事件。
   常驻两块不可见区域（polite / assertive），只改文本、不增删容器；同一句连续播报时先清空再写入，读屏才会重读。
   挂在 body 上而不是 #root 里：抽屉打开时 #root 是 inert，里面的播报区读屏听不到。 */
const subs = new Set()

export function announce(text, politeness = 'polite') {
  subs.forEach((fn) => fn({ text, politeness }))
}

export function LiveAnnouncer() {
  const [live, setLive] = useState({ polite: '', assertive: '' })
  useEffect(() => {
    const on = ({ text, politeness }) => {
      setLive((l) => ({ ...l, [politeness]: '' }))
      requestAnimationFrame(() => setLive((l) => ({ ...l, [politeness]: text })))
    }
    subs.add(on)
    return () => subs.delete(on)
  }, [])
  return createPortal(
    <>
      <div className="sr-only" role="status" aria-live="polite" data-live="polite">
        {live.polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" data-live="assertive">
        {live.assertive}
      </div>
    </>,
    document.body,
  )
}

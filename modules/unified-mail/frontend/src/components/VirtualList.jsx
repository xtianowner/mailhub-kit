import { useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

/* 虚拟滚动列表（干活层的长表：Hotmail 账号 1500+ 行、某个域名下的信箱）。
   ① 用的是页面本身的原生滚动（window），不劫持滚动、不套内层滚动框；只渲染可视区 + 上下各 overscan 行；
   ② directDomUpdates：滚动时各行位置由虚拟器直接写 transform，只有「可视区间」变了才让 React 重渲染，
      行组件再用 memo 包住，于是滚动时 React 几乎不干活；
   ③ 行高由 ResizeObserver 实测（窄屏的卡片式行会因长地址换行而变高），estimateSize 只是初始估计；
   ④ scrollMargin = 列表顶边到文档顶部的距离。列表上方的内容变高变矮（批量进度条出现、筛选换行）时重新量。 */
export function VirtualList({
  items,
  getKey,
  estimateSize = 60,
  renderItem,
  overscan = 8,
  className = '',
  label,
  onMouseMove,
}) {
  const ref = useRef(null)
  const [margin, setMargin] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY)
      setMargin((m) => (m === top ? m : top))
    }
    measure()
    // body 的尺寸变化覆盖了「列表上方的内容变化」：上方变高，body 也变高
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const v = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin: margin,
    getItemKey: (i) => getKey(items[i]),
    directDomUpdates: true,
  })

  return (
    <div ref={ref} className={`mh-vlist ${className}`} role="list" aria-label={label} onMouseMove={onMouseMove}>
      <div ref={v.containerRef} className="mh-vlist__inner">
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={v.measureElement}
            className="mh-vlist__item"
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={vi.index + 1}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

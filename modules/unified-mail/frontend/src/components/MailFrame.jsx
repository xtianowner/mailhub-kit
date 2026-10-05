import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/* ── 邮件 HTML 的显示框：不截断 + 适应宽度 + 缩放 + 高度跟随内容 ─────────────
   营销邮件常是固定 600px 甚至更宽的表格排版，比抽屉窄的可用宽度宽。以前 iframe 固定 60vh 高、
   自己带滚动条，宽出来的部分变成 iframe 内部的横向滚动 —— macOS 的滚动条平时隐藏，触控板竖滑
   常带一点横向分量，iframe 就悄悄往右滚，左边被吃掉（截图里的「etting Started」）。

   现在的做法：
   1. 先让邮件按「它自己需要的最小宽度」排版（body 的 min-width: min-content 把文档撑开，
      内容不会溢出、也就不存在看不到的左侧负偏移），得到排版宽度 L 和内容高度 H；
   2. iframe 设成 L × H（不再有内部滚动条），外面用 transform: scale(s) 等比缩放；
      外层占位块按缩放后的尺寸撑开，超出可用宽度时外层框水平滚动 —— 内容永远完整、可滚到。
   3. 适应宽度：s = 可用宽度 / L（只缩不放）；固定比例 z：按 可用宽度 / z 排版（流式邮件随比例重排，
      固定宽度邮件保持原排版），再放大 z 倍。

   读邮件尺寸需要父页能访问 iframe 文档，所以沙箱加了 allow-same-origin；**仍然不给 allow-scripts**：
   脚本、内联事件、javascript: 链接在这个文档里一律不执行，父页只读尺寸、挂监听，不往里执行任何邮件代码。
   同源的副作用：用户点「显示图片」后，指向本站的图片请求会带上本站 Cookie（云端版登录态是 Cookie）。
   credentialless 让这个 iframe 里的请求一律不带 Cookie（Chrome / Edge 支持，父页照样能读文档）；
   不支持它的浏览器会忽略这个属性。
   万一读不到文档（极端浏览器），退回旧的固定高度 + 内部滚动，邮件仍可看。 */

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const MAX_LAYOUT_WIDTH = 4000 // 极端邮件的排版宽度上限，防止异常尺寸把页面撑爆

/** 视觉上被左边缘切到的元素（左边 < 0 且右边 > 0）里最靠左的位置。
 *  完全在可视区左侧之外的元素（-9999px 的隐藏预览文本）是邮件故意藏起来的，不算。 */
function minVisibleLeft(doc) {
  let min = 0
  const all = doc.body ? doc.body.getElementsByTagName('*') : []
  const n = Math.min(all.length, 6000)
  for (let i = 0; i < n; i += 1) {
    const r = all[i].getBoundingClientRect()
    if (r.width > 1 && r.height > 1 && r.right > 0 && r.left < min) min = r.left
  }
  return min
}

export function MailFrame({ srcDoc, title, zoom = 'fit', onScale, className }) {
  const boxRef = useRef(null)
  const sizerRef = useRef(null)
  const frameRef = useRef(null)
  const [fallback, setFallback] = useState(false)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const onScaleRef = useRef(onScale)
  onScaleRef.current = onScale
  const rafRef = useRef(0)
  const lastWidthRef = useRef(0)
  const lastScaleRef = useRef(null)
  const cleanupRef = useRef(null)

  const measure = useCallback(() => {
    const box = boxRef.current
    const sizer = sizerRef.current
    const frame = frameRef.current
    if (!box || !sizer || !frame) return
    let doc = null
    try {
      doc = frame.contentDocument
    } catch {
      doc = null
    }
    // srcdoc 还没换上来时 contentDocument 是初始的空白文档：认我们自己打的标记
    if (!doc || !doc.body || !doc.documentElement.hasAttribute('data-mh-mail')) return
    const avail = box.clientWidth
    if (!avail) return
    const z = zoomRef.current === 'fit' ? null : Number(zoomRef.current)
    const de = doc.documentElement
    de.setAttribute('data-mh-measured', '')

    // 先把高度压到 1px 再量：撑满视口的写法（height:100%、100vh）才不会把上一次的高度「记住」
    frame.style.height = '1px'
    let L = Math.max(1, Math.floor(z ? avail / z : avail))
    for (let i = 0; i < 4; i += 1) {
      frame.style.width = `${L}px`
      let need = Math.ceil(de.scrollWidth)
      const left = minVisibleLeft(doc)
      if (left < -0.5) need = Math.max(need, L + Math.ceil(-left) * 2)
      if (need <= L) break
      L = Math.min(need, MAX_LAYOUT_WIDTH)
      if (L >= MAX_LAYOUT_WIDTH) {
        frame.style.width = `${L}px`
        break
      }
    }
    frame.style.width = `${L}px`
    const H = Math.max(1, Math.ceil(de.scrollHeight))
    frame.style.height = `${H}px`

    const scale = z || Math.min(1, avail / L)
    frame.style.transform = scale === 1 ? '' : `scale(${scale})`
    // 适应宽度时缩放后正好等于可用宽度；取整误差不能多出一像素去触发横向滚动条
    sizer.style.width = `${z ? L * scale : Math.min(avail, L * scale)}px`
    sizer.style.height = `${H * scale}px`
    if (lastScaleRef.current !== scale) {
      lastScaleRef.current = scale
      onScaleRef.current?.(scale)
    }
  }, [])

  const schedule = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(measure)
  }, [measure])

  // 每次 srcdoc 载入：挂上内容尺寸变化（图片加载、字体）与 Esc 转发
  const onLoad = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    const frame = frameRef.current
    let doc = null
    try {
      doc = frame?.contentDocument
    } catch {
      doc = null
    }
    if (!doc) {
      setFallback(true)
      return
    }
    // 初始的空白文档也可能触发一次 load：等真正的 srcdoc
    if (!doc.documentElement?.hasAttribute('data-mh-mail')) return
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    ro?.observe(doc.body)
    const onAsset = () => schedule()
    // 焦点在邮件正文里时，Esc 也要交给外层（抽屉：先退全屏、再关闭）
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
      frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    }
    doc.addEventListener('load', onAsset, true)
    doc.addEventListener('keydown', onKey)
    cleanupRef.current = () => {
      ro?.disconnect()
      doc.removeEventListener('load', onAsset, true)
      doc.removeEventListener('keydown', onKey)
    }
  }, [measure, schedule])

  // 可用宽度变化（拖抽屉、全屏、窗口缩放）：只看宽度，高度变化是我们自己撑出来的
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth
      if (w === lastWidthRef.current) return
      lastWidthRef.current = w
      schedule()
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [schedule])

  // 换缩放比例：同步重排，避免先闪一帧旧尺寸
  useLayoutEffect(() => {
    measure()
  }, [zoom, measure])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      cleanupRef.current?.()
    },
    [],
  )

  if (fallback) {
    return (
      <iframe
        ref={frameRef}
        sandbox="allow-same-origin"
        credentialless=""
        srcDoc={srcDoc}
        title={title}
        onLoad={onLoad}
        className={['mh-mailframe mh-mailframe--fallback', className].filter(Boolean).join(' ')}
      />
    )
  }

  return (
    <div ref={boxRef} className={['mh-mailframe', className].filter(Boolean).join(' ')}>
      <div ref={sizerRef} className="mh-mailframe__sizer">
        <iframe
          ref={frameRef}
          // 不给 allow-scripts：邮件里的脚本一律不执行。allow-same-origin 只为让父页读到排版尺寸（见文件头）。
          sandbox="allow-same-origin"
          credentialless=""
          srcDoc={srcDoc}
          title={title}
          onLoad={onLoad}
          scrolling="no"
          className="mh-mailframe__iframe"
        />
      </div>
    </div>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Mailbox } from 'lucide-react'
import { useMotionOK } from '../../lib/motion.js'

/* ── 汇流动画（MailHub 专属招牌）────────────────────────────────
   来源节点（Hotmail 账号池、各个域名）→ 曲线 → 中心枢纽。曲线是 SVG，光点是 Canvas 2D（不用 WebGL）。
   - mode="full"：节点卡 + 枢纽 + 出口虚线（统一总览的邮箱信息区）；
   - mode="stage"：登录页的全尺寸版，没有枢纽圆，光点汇进 hubAt 给的落点（手办怀里信封的封蜡）。
   离屏 / 标签页隐藏时暂停；减少动态效果时只画一帧静态图；devicePixelRatio 上限 2。
   Canvas 不认 CSS 变量：颜色用 getComputedStyle 读 token（空格三元组），主题切换时重读。

   nodes: [{ id, kind: 'hotmail' | 'domain', title, value?, health?: { ok, expiring, expired }, rate? }]
   arrival: { id, nodeId }   新邮件到达：在对应节点的曲线上发一颗大光点，节点冒「+1」 */

const readTriplet = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback

function bez(p, t) {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]]
}

function bezLen(p) {
  let len = 0
  let [px, py] = bez(p, 0)
  for (let i = 1; i <= 24; i += 1) {
    const [x, y] = bez(p, i / 24)
    len += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return len
}

function computeLayout(w, h, { mode, n, hubAt, outflow }) {
  const stage = mode === 'stage'
  const compact = w < 520
  const nodeW = stage ? Math.min(196, w * 0.4) : compact ? Math.min(158, w * 0.48) : Math.min(212, w * 0.4)
  const top = stage ? h * 0.16 : 6
  const bottom = stage ? h * 0.84 : h - 6
  const avail = bottom - top
  const maxH = compact ? 40 : 48
  const nodeH = Math.max(28, Math.min(maxH, (avail - (n - 1) * 6) / Math.max(n, 1)))
  const tight = nodeH < 40
  const gap = n > 1 ? (avail - n * nodeH) / (n - 1) : 0
  const startY = n === 1 ? top + (avail - nodeH) / 2 : top
  const hub = hubAt
    ? hubAt(w, h)
    : { x: w * (compact ? 0.8 : 0.74), y: h / 2, r: compact ? 24 : 32 }
  const r = hub.r ?? 0
  const nodes = []
  const paths = []
  for (let i = 0; i < n; i += 1) {
    const y = startY + i * (nodeH + gap)
    nodes.push({ x: 0, y, w: nodeW, h: nodeH })
    const ax = nodeW + 2
    const ay = y + nodeH / 2
    const bx = hub.x - r - (r ? 4 : 0)
    const by = hub.y + (i - (n - 1) / 2) * (stage ? 1.5 : 3)
    const pts = [ax, ay, ax + (bx - ax) * 0.55, ay, bx - (bx - ax) * 0.38, by, bx, by]
    paths.push({ pts, len: bezLen(pts) })
  }
  let out = null
  if (outflow && !stage) {
    const op = [hub.x + r + 4, hub.y, hub.x + r + 30, hub.y, w - 30, hub.y, w - 2, hub.y]
    out = { pts: op, len: bezLen(op) }
  }
  return { w, h, paths, nodes, hub, out, compact, tight }
}

const d = (p) => `M${p[0]},${p[1]} C${p[2]},${p[3]} ${p[4]},${p[5]} ${p[6]},${p[7]}`

export function HubFlow({
  nodes = [],
  arrival,
  mode = 'full',
  hubAt,
  outflow = true,
  formatValue = (v) => String(v),
  label,
  className = '',
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [layout, setLayout] = useState(null)
  const motionOK = useMotionOK()
  const state = useRef({ particles: [], acc: [], colors: null, running: false, spawn: null })
  const n = nodes.length
  const stage = mode === 'stage'
  // 节点种类与发射率只在节点集合变化时更新（数值变化不重建动画）
  const kindsKey = nodes.map((nd) => `${nd.id}:${nd.kind}:${nd.rate ?? ''}`).join('|')
  const kinds = useMemo(() => nodes.map((nd) => nd.kind), [kindsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rates = useMemo(() => nodes.map((nd) => nd.rate ?? 1), [kindsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const hubAtRef = useRef(hubAt)
  hubAtRef.current = hubAt

  // 尺寸 → 布局
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 10 || r.height < 10) return
      setLayout(computeLayout(r.width, r.height, { mode, n, hubAt: hubAtRef.current, outflow }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode, n, outflow])

  // 主循环
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !layout || !layout.paths.length) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(layout.w * dpr)
    canvas.height = Math.round(layout.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const st = state.current
    st.particles = []
    st.acc = layout.paths.map(() => Math.random())

    const readColors = () => {
      st.colors = {
        dark: document.documentElement.dataset.theme === 'dark',
        domain: readTriplet(wrap, '--accent', '13 148 136'),
        hotmail: readTriplet(wrap, '--src-hotmail', '7 89 133'),
      }
    }
    readColors()

    const spawn = (i, big = false, t = 0) => {
      const path = layout.paths[i]
      if (!path) return
      const speed = (stage ? 95 : 110) * (0.8 + Math.random() * 0.4) * (big ? 0.9 : 1)
      st.particles.push({ i, t, v: speed / path.len, big, kind: kinds[i] || 'domain', out: false })
    }
    st.spawn = spawn

    const dot = (x, y, r, rgb, a) => {
      ctx.fillStyle = `rgb(${rgb} / ${a})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    const draw = () => {
      const { colors } = st
      ctx.clearRect(0, 0, layout.w, layout.h)
      ctx.globalCompositeOperation = colors.dark ? 'lighter' : 'source-over'
      for (const p of st.particles) {
        const pts = p.out ? layout.out.pts : layout.paths[p.i].pts
        const rgb = colors[p.kind] || colors.domain
        const size = p.big ? 3.6 : 2.3
        // 尾迹：沿曲线往回取几颗渐隐的点
        const step = p.big ? 0.022 : 0.016
        for (let k = 5; k >= 1; k -= 1) {
          const tt = p.t - k * step
          if (tt < 0) continue
          const [tx, ty] = bez(pts, tt)
          dot(tx, ty, size * (1 - k * 0.12), rgb, 0.12 * (6 - k) * 0.35)
        }
        const [x, y] = bez(pts, Math.min(p.t, 1))
        dot(x, y, size * (p.big ? 4 : 3.2), rgb, p.big ? 0.24 : 0.16)
        dot(x, y, size, rgb, p.big ? 1 : 0.9)
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    // 减少动态效果：只画一帧静态光点，主题切换时重画
    if (!motionOK) {
      layout.paths.forEach((_, i) => [0.22, 0.5, 0.78].forEach((t) => spawn(i, false, t)))
      if (layout.out) [0.35, 0.75].forEach((t) => st.particles.push({ i: 0, t, v: 0, big: false, kind: 'domain', out: true }))
      draw()
      const mo = new MutationObserver(() => {
        readColors()
        draw()
      })
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      return () => mo.disconnect()
    }

    let raf = 0
    let last = performance.now()
    let visible = true
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      for (let i = 0; i < st.acc.length; i += 1) {
        st.acc[i] += dt * rates[i]
        while (st.acc[i] >= 1) {
          spawn(i)
          st.acc[i] -= 1
        }
      }
      const next = []
      for (const p of st.particles) {
        p.t += p.v * dt
        if (p.t >= 1) {
          if (!p.out && layout.out && (p.big || Math.random() < 0.45)) {
            p.out = true
            p.t = 0
            p.v = 140 / layout.out.len
            next.push(p)
          }
          continue
        }
        next.push(p)
      }
      st.particles = next
      draw()
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (st.running || !visible || document.visibilityState !== 'visible') return
      st.running = true
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      st.running = false
      cancelAnimationFrame(raf)
    }
    // 预热：开场时曲线上已有光点，而不是从空开始
    layout.paths.forEach((_, i) => {
      for (let j = 0; j < 2; j += 1) spawn(i, false, Math.random())
    })
    draw()

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) start()
      else stop()
    })
    io.observe(wrap)
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    document.addEventListener('visibilitychange', onVis)
    const mo = new MutationObserver(readColors)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    start()
    return () => {
      stop()
      st.spawn = null
      io.disconnect()
      mo.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [layout, motionOK, kinds, rates, stage])

  const arrivedIdx = arrival ? nodes.findIndex((nd) => nd.id === arrival.nodeId) : -1

  // 新邮件到达：在对应来源的曲线上发一颗大光点
  useEffect(() => {
    if (arrivedIdx < 0 || !motionOK) return
    state.current.spawn?.(arrivedIdx, true)
    // 只响应「这一封」到达
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival?.id])

  return (
    <div
      ref={wrapRef}
      className={`mh-flow mh-flow--${mode} ${className}`}
      role={stage ? undefined : 'img'}
      aria-hidden={stage ? true : undefined}
      aria-label={stage ? undefined : label}
    >
      {layout && (
        <svg className="mh-flow__svg" width={layout.w} height={layout.h} aria-hidden focusable="false">
          {layout.paths.map((p, i) => (
            <path key={i} d={d(p.pts)} className={`mh-flow__path mh-flow__path--${kinds[i] || 'domain'}`} />
          ))}
          {layout.out && <path d={d(layout.out.pts)} className="mh-flow__path mh-flow__path--out" />}
        </svg>
      )}
      <canvas ref={canvasRef} className="mh-flow__canvas" aria-hidden />
      {layout &&
        nodes.map((nd, i) => {
          const box = layout.nodes[i]
          if (!box) return null
          return (
            <div
              key={nd.id}
              className={`mh-node mh-node--${nd.kind} ${layout.tight || layout.compact ? 'is-compact' : ''}`}
              style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
              aria-hidden
              title={nd.title}
            >
              <span className="mh-node__dot" />
              <span className="mh-node__body">
                <span className="mh-node__title">{nd.title}</span>
                {nd.health && !layout.compact && !layout.tight && (
                  <span className="mh-node__health">
                    <i style={{ flexGrow: nd.health.ok }} className="ok" />
                    <i style={{ flexGrow: nd.health.expiring }} className="warn" />
                    <i style={{ flexGrow: nd.health.expired }} className="bad" />
                  </span>
                )}
              </span>
              {nd.value != null && <span className="mh-node__value">{formatValue(nd.value)}</span>}
              {i === arrivedIdx && (
                <span key={arrival.id} className="mh-node__ping">
                  +1
                </span>
              )}
            </div>
          )
        })}
      {layout && !stage && (
        <div
          className="mh-hub"
          style={{
            transform: `translate(${layout.hub.x - layout.hub.r}px, ${layout.hub.y - layout.hub.r}px)`,
            width: layout.hub.r * 2,
            height: layout.hub.r * 2,
          }}
          aria-hidden
        >
          <span className="mh-hub__ring" />
          <span className="mh-hub__ring mh-hub__ring--2" />
          {arrival && <span key={arrival.id} className="mh-hub__flash" />}
          <Mailbox size={layout.compact ? 18 : 22} />
          <span className="mh-hub__label">MailHub</span>
        </div>
      )}
    </div>
  )
}

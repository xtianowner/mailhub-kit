# Frontend DS Starter — Vite + React 19 + Tailwind v3 + Motion

复制本目录即新项目起点。已内置：设计 tokens、中英 i18n、响应式基座、`prefers-reduced-motion`、6 个 react-bits 种子组件（Magnet · SpotlightCard · BlurText · ShinyText · FadeContent · Particles）、「网格+粒子」全局背景、Hero 示例。

## 运行
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产物 dist/
```

## 约定（务必遵守）
- **改设计变量** → `src/styles/tokens.css`（唯一真相源）。
- **语义 class**：`bg-bg` / `bg-surface` / `text-text` / `text-muted` / `border-border` / `bg-gradient` / `shadow-glow` / `font-heading` / `rounded-lg`。不要写裸 HEX/px。
- **加 react-bits 组件**：从公开仓库 `https://github.com/DavidHDev/react-bits` 的 `src/tailwind/<类>/<名>/<名>.jsx`（TS 项目走 `src/ts-tailwind/`）拷进 `src/components/reactbits/`，安装其 import 的依赖（gsap / ogl / three 等），色值改成 token。
- 完整 playbook（全部 token 数值 / 组件分级 ✅⚠️🚫 / UX 铁律 / 反模式 / 动效优化 / 9 条检查清单）见 Claude Code agent **frontend-reactbits**（自包含，无需外部契约 .md）。

> 种子组件：Magnet 为 react-bits 原文件；BlurText / ShinyText / FadeContent 加了 reduced-motion 兜底；SpotlightCard 已 re-tokenize 为 bg-surface/border-border；Particles 被 DynamicBackground（「网格+粒子」默认背景）内置使用。re-tokenize = 直接改组件源码的色值 class（种子未统一走 cn()/twMerge，靠 className 追加覆盖不可靠）。

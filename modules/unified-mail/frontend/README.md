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
- **视觉基线**：颜色、字体、圆角、动效按作者博客的「视觉基线」（青绿主色），数值以 `src/styles/tokens.css` 为准。颜色变量是空格分隔的 RGB 三元组（如 `--accent: 13 148 136`），浅色、深色各一套；不透明写 `rgb(var(--accent))`，半透明写 `rgb(var(--accent) / 0.12)`，Tailwind 的 `bg-accent/10` 也映射成这种写法。全项目只用这一种分隔方式，不要混进逗号三元组。字体 Atkinson 自托管在 `src/assets/fonts/`。
- **品牌包**：形象插画与页脚署名放在 `src/brand/<名字>/brand.js`（约定见 `src/brand/index.js`）。构建时用环境变量 `VITE_BRAND` 选择，不设或目录不存在就用 `src/brand/default/`（自绘信封插画、无署名）。
- **语义 class**：`bg-bg` / `bg-surface` / `bg-surface-2` / `text-heading` / `text-text` / `text-muted` / `border-border` / `bg-accent` / `font-heading` / `font-mono` / `rounded-lg`。不要写裸 HEX/px。
- **加 react-bits 组件**：从公开仓库 `https://github.com/DavidHDev/react-bits` 的 `src/tailwind/<类>/<名>/<名>.jsx`（TS 项目走 `src/ts-tailwind/`）拷进 `src/components/reactbits/`，安装其 import 的依赖（gsap / ogl / three 等），色值改成 token。
- 完整 playbook（全部 token 数值 / 组件分级 ✅⚠️🚫 / UX 铁律 / 反模式 / 动效优化 / 9 条检查清单）见 Claude Code agent **frontend-reactbits**（自包含，无需外部契约 .md）。


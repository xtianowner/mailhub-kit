import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from './theme/ThemeProvider.jsx'
import { LocaleProvider } from './i18n/LocaleProvider.jsx'
import App from './App.jsx'
import { brand } from './brand/index.js'
import './styles/index.css'

// 当前品牌包写在 <html data-brand> 上：样式可按品牌微调，验收时也能直接看出产物用的是哪个品牌包
document.documentElement.dataset.brand = brand.id

// MotionConfig reducedMotion="user" → 所有 motion 组件自动遵守 prefers-reduced-motion（转场/位移）。
// 注意：rAF 驱动的无限动画（如 ShinyText）仍需组件内 useReducedMotion 兜底。
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>,
)

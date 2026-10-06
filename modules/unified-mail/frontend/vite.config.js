import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 两种构建目标共用这份配置，靠 VITE_TARGET 区分：
//   （默认）本地版 → 相对路径 /api/*，dev 时 proxy 到本机统一层 :8080 起步端口
//   cloud     云端版 → 浏览器直连 CFMail；纯静态，部署到 Cloudflare Pages
//
// preview 的 proxy 只为**本地验收云端版**存在：CORS 部署上线前，把 /admin 与 /api
// 转给真实 CFMail，使页面变成同源，从而能用真数据核验界面。线上不经过它。
const CFMAIL = 'https://api-mail.example.com'
const runtimePortFile = fileURLToPath(new URL('../../../.run/unified-mail.port', import.meta.url))
const persistedPort = fs.existsSync(runtimePortFile) ? fs.readFileSync(runtimePortFile, 'utf8').trim() : ''
const hubPort = Number(
  process.env.MAILHUB_PORT ||
  persistedPort ||
  process.env.MAILHUB_BASE_PORT ||
  8080,
)

// 品牌包（src/brand/<名字>/）在构建时选定：VITE_BRAND 指向的目录存在就用它，否则退回 default。
// 选中的品牌包目录不存在时（例如还没准备好 custom），会安静地退回 default，不会构建失败；安装器另有前置检查。
// 只把选中的那一个解析进产物（别名 #brand），其它品牌包的图片不会被打包。
const BRAND_ROOT = fileURLToPath(new URL('./src/brand/', import.meta.url))
function pickBrand() {
  const want = (process.env.VITE_BRAND || '').trim()
  if (!want || want === 'default') return 'default'
  if (/^[a-z0-9_-]+$/i.test(want) && fs.existsSync(path.join(BRAND_ROOT, want, 'brand.js'))) return want
  console.warn(`[brand] 品牌包「${want}」不存在，退回 default`)
  return 'default'
}
const BRAND = pickBrand()

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '#brand': path.join(BRAND_ROOT, BRAND) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${hubPort}`, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/admin': { target: CFMAIL, changeOrigin: true },
      '/api': { target: CFMAIL, changeOrigin: true },
    },
  },
})

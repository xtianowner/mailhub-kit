import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
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

export default defineConfig({
  plugins: [react()],
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

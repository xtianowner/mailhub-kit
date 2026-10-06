// 通用品牌包（init --brand default，以及老版本升级上来的安装）：自绘的信封插画，不含任何个人形象，也没有页脚署名。
// 想换成自己的形象：照 ../index.js 顶部的约定新建一个同级目录（含 brand.js），构建时设 VITE_BRAND=<目录名>。
import { EnvelopeArt } from './EnvelopeArt.jsx'

export default {
  id: 'default',
  // 矢量插画：每个姿势给出宽高比与封蜡的相对位置（登录页汇流光点的落点）
  art: EnvelopeArt,
  figures: {
    hero: { width: 400, height: 520, seal: [0.5, 0.692] },
    search: { width: 400, height: 400 },
    wait: { width: 400, height: 400 },
  },
  credit: null,
}

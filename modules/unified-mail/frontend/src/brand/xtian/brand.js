// 作者品牌包：XTian 手办形象 + 页脚署名。私有版构建（package.json 的 build / build:cloud）与开源版新安装（init --brand xtian，默认）都用它。
// 形象按 CC BY 4.0 授权，使用时必须保留页脚署名，见同目录 LICENSE.md；不想用的选 custom（自己的形象）或 default（通用信封插画）。
// 手办素材从博客仓复制而来（不直接引用博客路径），透明底 webp、高 900px。
import hero from './fig-mailhub.webp'
import search from './fig-mailhub-search.webp'
import wait from './fig-mailhub-wait.webp'

export default {
  id: 'xtian',
  // 位图形象：每个姿势给出图片、像素尺寸与替代文本。seal = 信封封蜡在图里的相对位置（登录页汇流光点的落点、呼吸光的位置）
  figures: {
    hero: {
      src: hero,
      width: 480,
      height: 900,
      seal: [0.417, 0.552],
      alt: { zh: 'XTian 手办抱着一封封着青绿火漆的信', en: 'XTian figure hugging a letter with a teal wax seal' },
    },
    search: {
      src: search,
      width: 563,
      height: 900,
      alt: { zh: 'XTian 手办踮着脚把信封举过头顶找信', en: 'XTian figure on tiptoe, holding an envelope up while looking for mail' },
    },
    wait: {
      src: wait,
      width: 488,
      height: 900,
      alt: { zh: 'XTian 手办坐在一摞信封上等信', en: 'XTian figure sitting on a stack of envelopes, waiting for mail' },
    },
  },
  // 页脚署名：只有这个品牌包有
  credit: {
    name: 'XTian',
    href: 'https://blog.example.com',
    label: { zh: '博客', en: 'Blog' },
  },
}

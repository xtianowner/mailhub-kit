// 品牌包入口：界面里所有「形象插画 + 页脚署名」都从这里取，组件不直接引用某个品牌目录。
//
// 品牌包 = src/brand/<名字>/brand.js（默认导出一个对象）：
//   id        品牌名
//   figures   { hero, search, wait }：每个姿势的 width / height（宽高比），hero 另给 seal = [x, y]（封蜡相对位置）；
//             位图形象再给 src 与 alt: { zh, en }
//   art       （可选）矢量插画组件 ({ pose }) => <svg>；没有 src 的姿势用它画
//   credit    （可选）页脚署名 { name, href, label: { zh, en } }；null = 不显示署名
//
// 选哪个品牌包在**构建时**决定（vite.config.js）：读环境变量 VITE_BRAND，对应目录存在就用它，
// 不设或目录不存在（例如开源版里没有作者品牌包）一律退回 default。
// 之所以不在这里用 import.meta.glob 列举全部品牌包：glob 会把每个品牌包都打进产物，
// 开源 / 默认构建里就会夹带作者的形象图；构建时只解析选中的那一个，产物里只有它。
import pack from '#brand/brand.js'

export const brand = pack

/** 某个姿势的形象说明；不存在的姿势退回 hero */
export function brandFigure(pose = 'hero') {
  return pack.figures?.[pose] || pack.figures?.hero || null
}

/** 单选分段控件的方向键：←/→ 在选项间移动并选中（WAI-ARIA radiogroup） */
export function segKeyDown(e, values, value, onChange) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const group = e.currentTarget // 事件派发结束后 currentTarget 会被清空，先存下来
  const i = values.indexOf(value)
  let next = i
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = values.length - 1
  else next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + values.length) % values.length
  onChange(values[next])
  requestAnimationFrame(() => group.querySelectorAll('[role="radio"]')[next]?.focus())
}

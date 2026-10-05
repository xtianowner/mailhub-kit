/** Tailwind v3.4 —— 把语义类映射到 src/styles/tokens.css 的设计变量（视觉基线 v1.2，青绿风格）。
 *  组件只写语义类（bg-surface、text-muted、border-border、bg-accent/10…），不写裸色值。
 *  变量是空格分隔的 RGB 三元组（基线 §2.1 的 Tailwind 例外），所以透明度走 Tailwind 原生的斜杠写法：
 *  bg-accent/10 → rgb(var(--accent) / 0.1)。整个项目只用这一种写法，不和逗号三元组混用。 */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`

// 主色的四种用法（数值都来自基线 token，取舍说明见 tokens.css「派生用法」）
const accent = {
  DEFAULT: c('--accent'), // 描边、焦点环、选中底色
  hover: c('--accent-strong'),
  strong: c('--accent-strong'),
  ink: c('--accent-ink'), // 小字 / 链接：浅色下用加深档保 AA
  fill: c('--accent-fill'), // 主按钮底
  fg: c('--on-accent'), // 主按钮上的字
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('--bg'),
        surface: c('--bg-elev'), // 卡片、顶栏、弹层
        'surface-2': c('--bg-tint'), // 淡填充：表头、输入框底、行悬停
        border: c('--border'),
        heading: c('--heading'),
        text: c('--text'),
        muted: c('--muted'),
        subtle: c('--muted'), // 基线只有一档次要文字；小字一律保 AA
        accent,
        'accent-fill-hover': 'var(--accent-fill-hover)',
        'on-accent': c('--on-accent'),
        success: c('--success'),
        warning: c('--warning'),
        danger: c('--danger'),
        info: c('--info'),
        'src-hotmail': c('--src-hotmail'),
        paper: c('--paper'),
      },
      // 文字场景下 text-accent / text-success 走 --accent-ink（浅色 #0D9488 压浅底只有 3.7:1，不过 AA）
      textColor: {
        accent: { ...accent, DEFAULT: c('--accent-ink') },
        success: c('--accent-ink'),
      },
      borderRadius: {
        sm: 'var(--radius-field)',
        DEFAULT: 'var(--radius-field)', // 输入框、小标签、代码块：6px
        md: 'var(--radius-field)',
        lg: 'var(--radius-card)', // 卡片、面板、弹层：12px
        xl: 'var(--radius-card)',
        full: 'var(--radius-pill)', // 按钮、胶囊、开关：999px
      },
      boxShadow: {
        DEFAULT: 'var(--shadow)',
        card: 'var(--shadow)',
        lift: 'var(--shadow-lift)',
      },
      fontFamily: {
        heading: 'var(--font-sans)',
        body: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      transitionTimingFunction: {
        out: 'var(--ease)',
        DEFAULT: 'var(--ease)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur)',
        DEFAULT: 'var(--dur-fast)',
      },
      zIndex: {
        dropdown: '10', sticky: '20', overlay: '30', modal: '40', toast: '50',
      },
    },
  },
  plugins: [],
}

/** Tailwind v3.4 — maps to CSS-variable design tokens (single source: src/styles/tokens.css).
 *  Use semantic classes (bg-bg, text-muted, border-border, rounded-lg, font-heading...) so
 *  every project stays on-token. Don't add raw hex/px utilities ad-hoc. */
/** CSS-var color that still honours Tailwind slash-opacity (e.g. bg-surface/70).
 *  Plain `var(--x)` strings drop the `/NN` modifier entirely; this function emits
 *  color-mix when an opacity is requested, staying theme-aware (reads the live var). */
const tk = (v) => ({ opacityValue } = {}) => {
  // Tailwind passes a numeric literal for `/NN` slash-opacity, but a non-numeric
  // `var(--tw-*-opacity)` for the default path — only color-mix in the numeric case.
  const n = Number(opacityValue)
  return Number.isFinite(n) && opacityValue !== undefined && opacityValue !== null
    ? `color-mix(in srgb, var(${v}) ${n * 100}%, transparent)`
    : `var(${v})`
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: tk('--bg'),
        surface: tk('--surface'),
        'surface-2': tk('--surface-2'),
        border: tk('--border'),
        text: tk('--text'),
        muted: tk('--text-muted'),
        subtle: tk('--text-subtle'),
        accent: { DEFAULT: tk('--accent'), hover: tk('--accent-hover'), fg: tk('--accent-fg') },
        'accent-2': tk('--accent-2'),
        'on-bright': tk('--on-bright'),
        success: tk('--success'),
        warning: tk('--warning'),
        danger: tk('--danger'),
        info: tk('--info'),
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        inout: 'var(--ease-inout)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '400ms',
        slower: '600ms',
      },
      backgroundImage: {
        gradient: 'var(--gradient)',
        glow: 'var(--bg-glow)',
        mesh: 'var(--bg-mesh)',
        scrim: 'var(--scrim)',
      },
      boxShadow: {
        glow: 'var(--glow)',
      },
      zIndex: {
        dropdown: '10', sticky: '20', overlay: '30', modal: '40', toast: '50',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shine: {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
        'gradient-x': {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s var(--ease-out) both',
        shine: 'shine 3s linear infinite',
        'gradient-x': 'gradient-x 6s ease infinite',
      },
    },
  },
  plugins: [],
}

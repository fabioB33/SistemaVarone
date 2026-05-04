import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'hsl(var(--bg-canvas) / <alpha-value>)',
        surface: 'hsl(var(--bg-surface) / <alpha-value>)',
        elevated: 'hsl(var(--bg-elevated) / <alpha-value>)',
        subtle: 'hsl(var(--bg-subtle) / <alpha-value>)',
        fg: {
          DEFAULT: 'hsl(var(--fg-primary) / <alpha-value>)',
          secondary: 'hsl(var(--fg-secondary) / <alpha-value>)',
          muted: 'hsl(var(--fg-muted) / <alpha-value>)',
          subtle: 'hsl(var(--fg-subtle) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'hsl(var(--border-default) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
          subtle: 'hsl(var(--border-subtle) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          strong: 'hsl(var(--accent-strong) / <alpha-value>)',
          fg: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        ok: 'hsl(var(--success) / <alpha-value>)',
        warn: 'hsl(var(--warning) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      fontSize: {
        // Modular scale ratio 1.25
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }], // 11px
        xs:   ['0.75rem',   { lineHeight: '1rem' }],          // 12px
        sm:   ['0.875rem',  { lineHeight: '1.25rem' }],       // 14px
        base: ['1rem',      { lineHeight: '1.5rem' }],        // 16px
        lg:   ['1.125rem',  { lineHeight: '1.625rem' }],      // 18px
        xl:   ['1.25rem',   { lineHeight: '1.75rem' }],       // 20px
        '2xl':['1.5rem',    { lineHeight: '2rem',  letterSpacing: '-0.01em' }], // 24px
        '3xl':['1.875rem',  { lineHeight: '2.25rem', letterSpacing: '-0.02em' }], // 30px
        '4xl':['2.25rem',   { lineHeight: '2.5rem', letterSpacing: '-0.025em' }], // 36px
        '5xl':['3rem',      { lineHeight: '1.05',   letterSpacing: '-0.03em' }], // 48px
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        glow: 'var(--shadow-glow-accent)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(0.85)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 250ms cubic-bezier(0.22, 1, 0.36, 1)',
        'pulse-dot': 'pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;

/**
 * tailwind.config.ts — Nexus DS v2
 *
 * Étend les defaults Tailwind avec les CSS variables de styles/tokens.css :
 *  - tokens shadcn `hsl(var(--*))` pour la cohabitation avec shadcn/ui
 *  - tokens Nexus `var(--nx-*)` exposés en classes `bg-nx-discord`, etc.
 */
import animate from 'tailwindcss-animate';
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', "[data-theme='dark']"],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx,mdx}', '../landing/src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        // shadcn surface tokens
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Nexus-specific (raw vars)
        nx: {
          bg: 'var(--nx-bg)',
          surface: 'var(--nx-surface)',
          elevated: 'var(--nx-elevated)',
          raised: 'var(--nx-raised)',
          fg: 'var(--nx-fg)',
          'fg-muted': 'var(--nx-fg-muted)',
          'fg-dim': 'var(--nx-fg-dim)',
          'fg-ghost': 'var(--nx-fg-ghost)',
          border: 'var(--nx-border)',
          'border-hover': 'var(--nx-border-hover)',
          'border-strong': 'var(--nx-border-strong)',
          primary: 'var(--nx-primary)',
          'primary-hover': 'var(--nx-primary-hover)',
          'primary-deep': 'var(--nx-primary-deep)',
          'primary-muted': 'var(--nx-primary-muted)',
          'primary-text': 'var(--nx-primary-text)',
          accent: 'var(--nx-accent)',
          'accent-bg': 'var(--nx-accent-bg)',
          success: 'var(--nx-success)',
          'success-bg': 'var(--nx-success-bg)',
          warning: 'var(--nx-warning)',
          'warning-bg': 'var(--nx-warning-bg)',
          error: 'var(--nx-error)',
          'error-bg': 'var(--nx-error-bg)',
          info: 'var(--nx-info)',
          'info-bg': 'var(--nx-info-bg)',
          discord: 'var(--nx-discord)',
          'discord-bg': 'var(--nx-discord-bg)',
          whatsapp: 'var(--nx-whatsapp)',
          'whatsapp-bg': 'var(--nx-whatsapp-bg)',
          messenger: 'var(--nx-messenger)',
          'messenger-bg': 'var(--nx-messenger-bg)',
          'viz-bar': 'var(--nx-viz-bar)',
          'viz-bar-active': 'var(--nx-viz-bar-active)',
          'viz-line': 'var(--nx-viz-line)',
          'viz-stop': 'var(--nx-viz-stop)',
          'viz-price': 'var(--nx-viz-price)',
          'segmented-active': 'var(--nx-segmented-active)',
          'segmented-active-fg': 'var(--nx-segmented-active-fg)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '500' }],
        sm: ['13px', { lineHeight: '18px', letterSpacing: '0', fontWeight: '500' }],
        base: ['14px', { lineHeight: '20px', letterSpacing: '0', fontWeight: '500' }],
        md: ['15px', { lineHeight: '22px', letterSpacing: '-0.005em', fontWeight: '500' }],
        lg: ['16px', { lineHeight: '24px', letterSpacing: '-0.005em', fontWeight: '600' }],
        xl: ['18px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '600' }],
        '2xl': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '700' }],
        '3xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '700' }],
        '4xl': ['36px', { lineHeight: '42px', letterSpacing: '-0.025em', fontWeight: '700' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
        xl: 'calc(var(--radius) + 6px)',
        '2xl': 'calc(var(--radius) + 14px)',
        pill: '9999px',
        // alias preserved for legacy usage
        nx: 'var(--radius)',
        'nx-sm': 'var(--nx-radius-sm)',
        'nx-xs': 'var(--nx-radius-xs)',
        'nx-pill': 'var(--nx-radius-pill)',
      },
      boxShadow: {
        xs: 'var(--nx-shadow-xs)',
        sm: 'var(--nx-shadow-sm)',
        md: 'var(--nx-shadow-md)',
        lg: 'var(--nx-shadow-lg)',
        glow: 'var(--nx-shadow-glow)',
        focus: 'var(--nx-shadow-focus)',
      },
      spacing: {
        rail: '280px',
        'groups-rail': '64px',
        'channels-rail': '300px',
        'card-x': '24px',
        'card-y': '20px',
      },
      transitionTimingFunction: {
        nx: 'cubic-bezier(0.16, 1, 0.3, 1)',
        'nx-spring': 'cubic-bezier(0.5, 1.4, 0.5, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '420ms',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%,60%': { transform: 'translateX(-4px)' },
          '40%,80%': { transform: 'translateX(4px)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        'spin-orbit': { to: { transform: 'rotate(360deg)' } },
        'check-pop': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.15)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'pulse-glow': {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(144,128,248,0.40)' },
          '50%': { boxShadow: '0 0 0 12px rgba(144,128,248,0.00)' },
        },
        'typing-dot': {
          '0%,80%,100%': { transform: 'translateY(0)', opacity: '0.4' },
          '40%': { transform: 'translateY(-3px)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 250ms cubic-bezier(0.16,1,0.3,1) both',
        shake: 'shake 320ms cubic-bezier(0.36,0.07,0.19,0.97)',
        'spin-slow': 'spin-slow 8s linear infinite',
        'spin-orbit': 'spin-orbit 14s linear infinite',
        'check-pop': 'check-pop 280ms cubic-bezier(0.16,1,0.3,1)',
        float: 'float 4s cubic-bezier(0.45,0,0.55,1) infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'typing-dot': 'typing-dot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;

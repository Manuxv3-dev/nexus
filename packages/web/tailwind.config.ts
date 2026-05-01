import type { Config } from 'tailwindcss';

/**
 * Tailwind config @nexus/web.
 *
 * On reste sur le scale par défaut Tailwind, et on s'appuie sur les CSS
 * variables de `nexus-tokens.css` pour le theming dark/light. Toutes les
 * couleurs Nexus sont exposées via `bg-nx-primary`, `text-nx-fg`, etc.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Mappage vers les CSS variables (cf. src/styles/tokens.css)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        accent: 'hsl(var(--accent))',
        destructive: 'hsl(var(--destructive))',
        border: 'hsl(var(--border))',
        ring: 'hsl(var(--ring))',
        nx: {
          surface: 'hsl(var(--nx-surface))',
          elevated: 'hsl(var(--nx-elevated))',
          raised: 'hsl(var(--nx-raised))',
          'primary-text': 'hsl(var(--nx-primary-text))',
          'primary-deep': 'hsl(var(--nx-primary-deep))',
          success: 'hsl(var(--nx-success))',
          error: 'hsl(var(--nx-error))',
          warning: 'hsl(var(--nx-warning))',
          info: 'hsl(var(--nx-info))',
          discord: 'hsl(var(--nx-discord))',
          whatsapp: 'hsl(var(--nx-whatsapp))',
          messenger: 'hsl(var(--nx-messenger))',
        },
      },
      borderRadius: {
        nx: 'var(--radius)',
        'nx-sm': 'var(--nx-radius-sm)',
        'nx-xs': 'var(--nx-radius-xs)',
        'nx-pill': 'var(--nx-radius-pill)',
      },
      transitionTimingFunction: {
        nx: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-6px)' },
          '75%': { transform: 'translateX(6px)' },
        },
        spinSlow: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        checkPop: {
          '0%': { transform: 'scale(0)' },
          '60%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease',
        shake: 'shake 0.3s ease',
        'spin-slow': 'spinSlow 1s linear infinite',
        'spin-orbit': 'spinSlow 20s linear infinite',
        'check-pop': 'checkPop 0.5s ease',
        float: 'float 3s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;

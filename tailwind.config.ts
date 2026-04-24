import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    content: [
  "./src/**/*.{js,ts,jsx,tsx,mdx}",
],
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        dark:    '#10211f',
        dark2:   '#152928',
        dark3:   '#1c3533',
        dark4:   '#243f3c',
        lime:    '#dffe95',
        lime2:   '#cef57e',
        cream:   '#F5F2EC',
        cream2:  '#EDE8DF',
        // Status
        'status-green':  '#86efac',
        'status-red':    '#f87171',
        'status-amber':  '#fbbf24',
        'status-blue':   '#93c5fd',
      },
      fontFamily: {
        sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
        '4xl': '24px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fadeUp 0.4s ease forwards',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'lime': '0 0 24px rgba(223,254,149,0.25)',
        'dark': '0 8px 32px rgba(16,33,31,0.3)',
      },
    },
  },
  plugins: [],
}

export default config

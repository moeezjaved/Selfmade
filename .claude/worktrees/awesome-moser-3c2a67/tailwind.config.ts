/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark:    '#2d5a27',
        dark2:   '#ffffff',
        dark3:   '#f0f7ee',
        dark4:   '#e0edd9',
        lime:    '#dffe95',
        lime2:   '#cef57e',
        cream:   '#f0f7ee',
        white: {
          DEFAULT: '#111827',
          10: 'rgba(17,24,39,0.06)',
          20: 'rgba(17,24,39,0.12)',
          30: 'rgba(17,24,39,0.18)',
          40: 'rgba(17,24,39,0.35)',
          50: 'rgba(17,24,39,0.5)',
          60: 'rgba(17,24,39,0.6)',
          70: 'rgba(17,24,39,0.7)',
          80: 'rgba(17,24,39,0.8)',
          90: 'rgba(17,24,39,0.9)',
        },
        'status-green':  '#2d7a2d',
        'status-red':    '#c0392b',
        'status-amber':  '#b8860b',
        'status-blue':   '#2563eb',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Inter', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

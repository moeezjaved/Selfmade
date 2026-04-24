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
        dark:    '#10211f',
        dark2:   '#152928',
        dark3:   '#1c3533',
        dark4:   '#243f3c',
        lime:    '#dffe95',
        lime2:   '#cef57e',
        cream:   '#F5F2EC',
        'status-green':  '#86efac',
        'status-red':    '#f87171',
        'status-amber':  '#fbbf24',
        'status-blue':   '#93c5fd',
      },
      fontFamily: {
        sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

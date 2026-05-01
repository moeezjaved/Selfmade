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
        dark:    '#1a3a1a',
        dark2:   '#ffffff',
        dark3:   '#eef5eb',
        dark4:   '#d8ebd4',
        lime:    '#dffe95',
        lime2:   '#cef57e',
        cream:   '#f0f7ee',
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

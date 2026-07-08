/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#131A2B',       // near-black navy for text/headers
        slate: {
          850: '#1E2A47',     // deep navy panels
          950: '#0B0F1A',
        },
        amber: {
          DEFAULT: '#F0A93B', // warehouse signage amber, used sparingly
        },
        paper: '#F6F7F9',
        line: '#E3E6EC',
        good: '#1E7A4C',
        warn: '#B8790B',
        bad: '#B23A2E',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

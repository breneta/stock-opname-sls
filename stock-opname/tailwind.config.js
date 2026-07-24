/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // Ceramics-warehouse palette (clay / terracotta) — same tokens as
      // before, just recolored, so every page that already uses bg-slate-850,
      // text-ink, bg-paper, border-line, etc. picks up the new look without
      // touching each component. See the approved mockup for reference hexes.
      colors: {
        ink: '#2B1710',        // warm near-black clay for text/headers
        slate: {
          850: '#A83F22',      // terracotta — primary buttons, active tab, links
          950: '#7A2E19',      // pressed/hover state
        },
        amber: {
          DEFAULT: '#E0932F',  // kiln amber, used for the main petugas action button
        },
        teal: {
          DEFAULT: '#2A9D8F',
          700: '#1F7A70',
        },
        paper: '#FBF6F0',      // warm ceramic off-white page background
        line: '#E9DFD3',       // warm hairline borders
        good: '#3B6D11',
        warn: '#854F0B',
        bad: '#A32D2D',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Inter', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

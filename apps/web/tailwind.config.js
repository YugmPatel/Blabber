/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Blabber brand system (teal / seafoam / aqua / mint): the whole app
        // already uses `slate-*` for dark surfaces/borders/text and `teal-*`
        // as its single accent color, so recoloring the accent scale here
        // (instead of hand-editing every page) gives every existing screen
        // the approved teal/aqua/mint palette automatically — no violet,
        // magenta, or saturated blue. `slate` already reads as a calm
        // blue-black scale in dark mode, so it is left as-is app-wide;
        // only `teal` (the accent scale) changes, running from mint (100-300,
        // light tints/highlights) through aqua (400) to the primary teal
        // (500-700, buttons/badges/sent-message bubbles/focus states).
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#96a3bd',
          500: '#64748b',
          600: '#485174',
          700: '#333d5c',
          800: '#121a30',
          900: '#0c1224',
          950: '#060916',
        },
        teal: {
          50: '#f0fbf9',
          100: '#ddf7f0',
          200: '#beefe4',
          300: '#8eebdd',
          400: '#2ac8bd',
          500: '#13c8b1',
          600: '#0bae9a',
          700: '#008f82',
          800: '#0d766e',
          900: '#075048',
          950: '#052e2a',
        },
        blabber: {
          bg: '#060916',
          surface: '#0c1224',
          elevated: '#121a30',
          soft: '#161f38',
          cyan: '#45dfff',
          blue: '#627bff',
          violet: '#9668ff',
          pink: '#ef72d8',
          purple: '#7046e8',
        },
        // Soft coral — reserved for attention/error states only (never a
        // primary or accent color). Used sparingly in the Convo experience.
        coral: {
          50: '#fff1ee',
          100: '#ffe1da',
          300: '#ffab97',
          400: '#ff8f75',
          500: '#fb7361',
          600: '#e2543f',
        },
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'brand-glow-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out',
        'brand-glow-pulse': 'brand-glow-pulse 3.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

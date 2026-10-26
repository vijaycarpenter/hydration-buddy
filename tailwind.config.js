/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Ubuntu', 'Cantarell', '"Segoe UI"', '"Noto Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        aqua: {
          50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee',
          500: '#06b6d4', 600: '#0891b2', 700: '#0e7490', 800: '#155e75', 900: '#164e63',
        },
      },
      boxShadow: { soft: '0 8px 30px -12px rgba(14, 116, 144, 0.25)' },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {}
  },
  plugins: [
    require('@tailwindcss/typography')
  ]
}

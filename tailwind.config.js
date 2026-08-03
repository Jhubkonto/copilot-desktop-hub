/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--nexy-${name}) / <alpha-value>)`

export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        gray: {
          50: token('neutral-50'),
          100: token('neutral-100'),
          200: token('neutral-200'),
          300: token('neutral-300'),
          400: token('neutral-400'),
          500: token('neutral-500'),
          600: token('neutral-600'),
          700: token('neutral-700'),
          800: token('neutral-800'),
          900: token('neutral-900'),
          950: token('neutral-950')
        },
        nexy: {
          frame: token('outer-frame'),
          background: token('background'),
          surface: token('surface'),
          raised: token('raised-surface'),
          recessed: token('recessed-surface'),
          text: token('text'),
          muted: token('muted-text'),
          highlight: token('highlight-edge'),
          border: token('border'),
          'border-soft': token('soft-border'),
          shadow: token('shadow'),
          accent: token('accent'),
          'on-accent': token('on-accent'),
          error: token('error-main'),
          warning: token('warning-main'),
          success: token('success-main'),
          info: token('info-main'),
          activity: token('activity-main'),
          offline: token('offline-main'),
          project: {
            blue: { DEFAULT: token('project-blue-main'), light: token('project-blue-light'), dark: token('project-blue-dark') },
            green: { DEFAULT: token('project-green-main'), light: token('project-green-light'), dark: token('project-green-dark') },
            red: { DEFAULT: token('project-red-main'), light: token('project-red-light'), dark: token('project-red-dark') },
            purple: { DEFAULT: token('project-purple-main'), light: token('project-purple-light'), dark: token('project-purple-dark') },
            orange: { DEFAULT: token('project-orange-main'), light: token('project-orange-light'), dark: token('project-orange-dark') },
            pink: { DEFAULT: token('project-pink-main'), light: token('project-pink-light'), dark: token('project-pink-dark') },
            yellow: { DEFAULT: token('project-yellow-main'), light: token('project-yellow-light'), dark: token('project-yellow-dark') },
            cyan: { DEFAULT: token('project-cyan-main'), light: token('project-cyan-light'), dark: token('project-cyan-dark') },
            gray: { DEFAULT: token('project-gray-main'), light: token('project-gray-light'), dark: token('project-gray-dark') }
          }
        }
      },
      borderRadius: {
        'nexy-sm': 'var(--nexy-desktop-corner-small)',
        'nexy-md': 'var(--nexy-desktop-corner-medium)',
        'nexy-lg': 'var(--nexy-desktop-corner-large)'
      },
      boxShadow: {
        nexy: 'var(--nexy-desktop-shadow-offset) var(--nexy-desktop-shadow-offset) 0 rgb(var(--nexy-shadow))'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography')
  ]
}

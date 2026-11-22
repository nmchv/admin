/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#08090B',
        surface: '#111318',
        elevated: '#181B22',
        accent: '#5B8DEF',
        fg: '#F4F5F7',
        muted: '#9299A7',
        line: '#252A34',
        ok: '#3DBE7A',
        maint: '#5BA8F5',
        warn: '#E3B341',
        bad: '#EF6461',
        idle: '#6B7280',
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
    },
  },
  plugins: [],
};

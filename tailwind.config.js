/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        oxblood: '#9a3b2e',
        cream: '#fbfaf6',
        paper: '#f4f1e8',
        accent: '#d8b3ac',
        ink: '#1c1a17',
        dim: '#8a8478',
        edge: '#e0dcd0',
        cyan: '#3d6156',
        pink: '#b23a2e',
        green: '#2f7d5b',
        amber: '#c77d33',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        head: ['Oswald', 'sans-serif'],
        num: ['Oswald', 'sans-serif'],
        serif: ['Fraunces', 'serif'],
      },
    },
  },
  plugins: [],
};

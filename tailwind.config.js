/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark "status window" game palette. Token NAMES are kept from the old
        // editorial theme so every existing utility class remaps in place;
        // `oxblood` is now the neon-cyan brand accent, `cream` the deep-space
        // background, `paper` the glass panel base.
        oxblood: '#4dc3ff', // primary neon accent (brand / active / CTAs)
        cream: '#060d18',   // app background (deep navy)
        paper: '#0c1a2b',   // panel base
        accent: '#3a6ea5',  // secondary blue
        ink: '#dbe9fb',     // primary text
        dim: '#6f8cae',     // muted text
        edge: '#1c3a5c',    // borders / hairlines
        cyan: '#4dc3ff',    // study / info
        pink: '#ff4d6d',    // danger / negative
        green: '#3ddc97',   // success / positive
        amber: '#ffb454',   // warning
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

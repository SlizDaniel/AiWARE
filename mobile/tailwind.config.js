/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: { extend: { colors: { paper: '#f5f4f0', ink: '#292d2b', forest: '#315b45', accent: '#dce9dc' } } },
  plugins: [],
}

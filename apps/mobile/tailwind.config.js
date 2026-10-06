// NativeWind v4 Tailwind config (docs/03-design-system.md §11.4). Tokens live in @thuluth/config.
const thuluthPreset = require('@thuluth/config/tailwind/preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.ts', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), thuluthPreset.default ?? thuluthPreset],
};

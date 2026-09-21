/** @type {import('tailwindcss').Config} */
// "admin" replaces spacing only: p-3 is a ghost here, text-sm is fine.
module.exports = {
  content: ['./src/**/*.tsx', '../../packages/shared/src/**/*.tsx'],
  theme: {
    spacing: { 0: '0px', 4: '4px', 8: '8px', 16: '16px' },
  },
  plugins: [],
};

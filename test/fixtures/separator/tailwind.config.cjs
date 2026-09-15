/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.html'],
  prefix: 'tw-',
  separator: '_',
  theme: {
    fontSize: { s: '12px', m: '13px' },
    spacing: { 0: '0px', 2: '2px', 4: '4px' },
  },
};

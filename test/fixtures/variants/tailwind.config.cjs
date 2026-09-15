const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.html'],
  darkMode: 'class',
  theme: {
    // replaced scales: stock `text-sm` / `p-3` are gone
    fontSize: { s: '12px', m: '13px' },
    spacing: { 0: '0px', 2: '2px', 4: '4px' },
    // replaced screens: stock `sm`/`lg`/`xl`/`2xl` are gone, `md` kept, `tablet` added
    screens: { md: '768px', tablet: '900px' },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('hocus', ['&:hover', '&:focus']);
    }),
  ],
};

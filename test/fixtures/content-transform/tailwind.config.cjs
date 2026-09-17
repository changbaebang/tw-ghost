/** @type {import('tailwindcss').Config} */
module.exports = {
  // `transform` / `extract` are honoured by Tailwind's build but NOT by tw-ghost (warning, then continue).
  content: {
    files: ['./src/**/*.html'],
    relative: true,
    transform: { html: (content) => content.replace(/text-m/g, 'text-sm') },
    extract: { html: (content) => content.split(/\s+/) },
  },
  theme: { fontSize: { m: '13px' }, spacing: { 4: '4px' } },
};

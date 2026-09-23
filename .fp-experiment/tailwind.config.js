// Every scale below is REPLACED, so stock Tailwind keys produce no CSS and become ghosts.
module.exports = {
  content: ['./src/**/*.html'],
  theme: {
    fontSize: { s: ['12px', '16px'], m: ['13px', '18px'] },
    spacing: { 0: '0px', 2: '2px', 4: '4px' },
    zIndex: { base: '0', nav: '100' },
  },
  plugins: [],
};

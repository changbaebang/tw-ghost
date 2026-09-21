/** @type {import('tailwindcss').Config} */
// Replaced scales, like a design-system config: spacing has no 2.25 / 13, fontSize has no `mm`,
// borderRadius has no `xll`; stock Tailwind has none of 13 / 2.25 / mm / xll either. Identifiers in the source share a root with these utilities.
export default {
  content: ['./src/**/*.html'],
  theme: {
    spacing: { 0: '0px', 2: '2px', 4: '4px', 8: '8px', 16: '16px' },
    fontSize: { xs: '10px', s: '12px', m: '13px', l: '14px' },
    borderRadius: { 4: '4px', 8: '8px', xl: '12px', full: '9999px' },
  },
};

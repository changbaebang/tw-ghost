import type { Config } from 'tailwindcss';

// Acme design system: every scale below is REPLACED (not extended), so stock keys disappear.
const config: Config = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    fontSize: {
      xs: ['10px', '12px'],
      s: ['12px', '16px'],
      m: ['13px', { lineHeight: '1.4' }],
      l: ['14px', '20px'],
    },
    spacing: { 0: '0px', 2: '2px', 4: '4px', 8: '8px', 16: '16px' },
    zIndex: { base: '0', nav: '100', modal: '1000' },
    extend: {
      colors: { acme: { DEFAULT: '#123456', light: '#abcdef' } },
    },
  },
  plugins: [],
};

export default config;

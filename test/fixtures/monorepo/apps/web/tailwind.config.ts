import type { Config } from 'tailwindcss';

// "web" replaces fontSize only: text-sm is a ghost here, p-3 is fine.
const config: Config = {
  content: ['./src/**/*.tsx', '../../packages/shared/src/**/*.tsx'],
  theme: {
    fontSize: { s: ['12px', '16px'], m: ['13px', '18px'], l: ['14px', '20px'] },
  },
  plugins: [],
};

export default config;

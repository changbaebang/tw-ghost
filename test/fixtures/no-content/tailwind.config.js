/** @type {import('tailwindcss').Config} */
export default {
  // only a `raw` entry: there is no string glob for tw-ghost to scan
  content: [{ raw: '<p class="text-sm"></p>', extension: 'html' }],
};

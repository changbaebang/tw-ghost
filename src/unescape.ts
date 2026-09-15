/**
 * Unescape a CSS identifier the way a browser would, reversing the escaping
 * Tailwind applies to class names in selectors (`:` `/` `[` `]` `.` `!` `%`
 * become `\:` `\/` ... and commas become the hex escape `\2c `).
 *
 * Handles both single-character escapes (`\:`) and hex escapes with an
 * optional trailing whitespace terminator (`\2c `, `\21 `).
 */
export function unescapeCssIdentifier(input: string): string {
  if (!input.includes('\\')) return input;
  let out = '';
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    // Trailing backslash: keep it literally.
    if (i + 1 >= input.length) {
      out += ch;
      break;
    }
    const next = input[i + 1] as string;
    if (/[0-9a-fA-F]/.test(next)) {
      let hex = '';
      let j = i + 1;
      while (j < input.length && hex.length < 6 && /[0-9a-fA-F]/.test(input[j] as string)) {
        hex += input[j];
        j += 1;
      }
      // A single whitespace after a hex escape is part of the escape.
      if (j < input.length && /[ \t\n\r\f]/.test(input[j] as string)) j += 1;
      const codePoint = Number.parseInt(hex, 16);
      out += codePoint === 0 ? '�' : String.fromCodePoint(codePoint);
      i = j;
      continue;
    }
    out += next;
    i += 2;
  }
  return out;
}

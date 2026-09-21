import pc from 'picocolors';

type Colors = ReturnType<typeof pc.createColors>;

import type { Finding, GhostFinding, Report } from './analyze.js';

export interface FormatOptions {
  color?: boolean | undefined;
  /** `report.unknown` holds every raw unknown (`--unknown-all`), not the utility-like subset. */
  unknownAll?: boolean | undefined;
}

const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;

function formatFinding(f: Finding, extra: string, color: Colors): string[] {
  const lines: string[] = [];
  lines.push(
    `  ${color.bold(f.class)}  ${color.dim(`(${plural(f.count, 'occurrence')})`)}${extra}`,
  );
  for (const loc of f.locations) {
    lines.push(`    ${color.cyan(`${loc.file}:${loc.line}:${loc.col}`)}`);
  }
  const hidden = f.count - f.locations.length;
  if (hidden > 0) lines.push(color.dim(`    … and ${plural(hidden, 'more location')}`));
  return lines;
}

/** Human-readable report (what the CLI prints without --json). */
export function formatHuman(report: Report, options: FormatOptions = {}): string {
  const color = options.color === false ? pc.createColors(false) : pc;
  const out: string[] = [];
  const header =
    `tw-ghost · tailwindcss ${report.tailwindVersion} · ${report.configPath}\n` +
    `scanned ${plural(report.filesScanned, 'file')}, ${plural(report.candidateCount, 'candidate')} ` +
    `(${report.summary.ok} ok, ${report.summary.ghost} ghost, ${report.summary.unknownVariant} unknown-variant, ` +
    `${report.summary.unknown} unknown of which ${report.summary.unknownUtilityLike} utility-like) in ${report.durationMs}ms`;
  out.push(color.dim(header));
  out.push('');

  if (report.ghosts.length === 0) {
    out.push(
      color.green(
        '✔ No ghost classes: every stock-Tailwind class you use produces CSS in this config.',
      ),
    );
  } else {
    out.push(
      color.red(
        color.bold(
          `✖ ${plural(report.ghosts.length, 'ghost class', 'ghost classes')} — valid in stock Tailwind, produce no CSS in this config:`,
        ),
      ),
    );
    out.push('');
    for (const g of report.ghosts) out.push(...formatGhost(g, color), '');
  }

  if (report.unknown.length > 0) {
    const shown = report.unknown.length;
    const raw = report.summary.unknown;
    const header = options.unknownAll
      ? `? Unknown classes, everything (${shown} shown, ${report.summary.unknownUtilityLike} utility-like; drop --unknown-all to see only those):`
      : `? Unknown utility-like classes (${shown} shown, ${raw} raw; use --unknown-all for everything):`;
    out.push(color.yellow(header));
    out.push('');
    for (const u of report.unknown) out.push(...formatFinding(u, '', color), '');
  }

  if (report.unknownVariant.length > 0) {
    out.push(
      color.yellow(
        `? ${plural(report.unknownVariant.length, 'class', 'classes')} with an unknown variant (the utility works in this config, the variant chain does not):`,
      ),
    );
    out.push('');
    for (const u of report.unknownVariant) out.push(...formatFinding(u, '', color), '');
  }
  return out.join('\n').trimEnd();
}

function formatGhost(g: GhostFinding, color: Colors): string[] {
  const lines = formatFinding(g, '', color);
  if (g.stockCss.length > 0) lines.push(`    ${color.dim('stock:')} ${g.stockCss.join('; ')}`);
  if (g.suggestions.length > 0)
    lines.push(`    ${color.dim('try:')}   ${g.suggestions.join(', ')}`);
  return lines;
}

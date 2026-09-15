import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = (name: string): string => path.join(ROOT, 'test', 'fixtures', name);
export const CLI = path.join(ROOT, 'dist', 'cli.js');

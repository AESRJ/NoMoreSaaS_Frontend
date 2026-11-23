// Publica el recopilador revisable en apps/web/public/downloads junto con su SHA-256.
// Uso: node tools/diagnostic/build.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE = path.join(here, 'nomoresaas-diagnostico.mjs');
export const DOWNLOADS = path.resolve(here, '..', '..', 'apps', 'web', 'public', 'downloads');
export const TARGET = path.join(DOWNLOADS, 'nomoresaas-diagnostico.mjs');
export const CHECKSUM = `${TARGET}.sha256`;

export function checksumLine(buffer) {
  return `${createHash('sha256').update(buffer).digest('hex')}  nomoresaas-diagnostico.mjs\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readFileSync(SOURCE);
  mkdirSync(DOWNLOADS, { recursive: true });
  writeFileSync(TARGET, source);
  writeFileSync(CHECKSUM, checksumLine(source));
  process.stdout.write(`Publicado ${path.relative(process.cwd(), TARGET)} y su SHA-256.\n`);
}

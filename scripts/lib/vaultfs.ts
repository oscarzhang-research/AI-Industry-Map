// File-system helpers for maintenance scripts that work on a local clone of the private vault.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseRecordFile, publicProjection, recordPath, RECORD_DIRS, serializeRecord } from '../../src/lib/records.ts';
import type { AnyRecord, SiteConfig } from '../../src/lib/types.ts';
import { ROOT } from './load.ts';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** The vault clone: --vault <dir>, $VAULT_DIR, or ../AI-Industry-Map-private next to this repository. */
export function vaultDir(required = true): string | undefined {
  const dir = resolve(arg('vault') ?? process.env.VAULT_DIR ?? join(ROOT, '..', 'AI-Industry-Map-private'));
  if (!existsSync(join(dir, 'vault')) && !existsSync(join(dir, '.git'))) {
    if (!required) return undefined;
    console.error(`No vault clone at ${dir}. Clone the private repository there or pass --vault <dir>.`);
    process.exit(2);
  }
  return dir;
}

export function siteConfig(): SiteConfig {
  return parseYaml(readFileSync(join(ROOT, 'site.config.yaml'), 'utf8')) as SiteConfig;
}

/** Records under <root>/<theses|notes|journal|outlook>/*.md, with their absolute file paths. */
export function readRecords(root: string): { rec: AnyRecord; file: string }[] {
  const out: { rec: AnyRecord; file: string }[] = [];
  for (const sub of Object.values(RECORD_DIRS)) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const file = join(dir, f);
      out.push({ rec: parseRecordFile(readFileSync(file, 'utf8')), file });
    }
  }
  return out;
}

export function writeFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Bring the public copy of one record in line with its vault original: write the sanitized projection
 * for public records, remove any public copy of private ones. Returns what happened.
 */
export function syncPublicCopy(rec: AnyRecord, config: SiteConfig): 'published' | 'removed' | 'unchanged' {
  const pubFile = join(ROOT, recordPath(rec, 'content/views'));
  const proj = publicProjection(rec, config.defaults.publicHiddenFields);
  if (proj) {
    const text = serializeRecord(proj);
    if (existsSync(pubFile) && readFileSync(pubFile, 'utf8') === text) return 'unchanged';
    writeFile(pubFile, text);
    return 'published';
  }
  if (existsSync(pubFile)) {
    rmSync(pubFile);
    return 'removed';
  }
  return 'unchanged';
}

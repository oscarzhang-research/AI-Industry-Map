// The vault's inbox/: reports the owner dropped in to be filed.
//   node scripts/inbox.ts [--vault <dir>] [--json out.json]
// Lists each file with what will happen to it: sell-side PDFs always go to the private vault;
// Claude-written HTML goes public only if the privacy check finds nothing, otherwise to the vault;
// exact duplicates of a report already filed are flagged. Filing itself is `npm run ingest` per file
// (with --private for private HTML), then a meta.yaml written in our own words, then removing the file
// from inbox/ (see the vault's CLAUDE.md).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ROOT } from './lib/load.ts';
import { htmlText, privacyHits } from './lib/privacy.ts';
import { arg, vaultDir } from './lib/vaultfs.ts';

export interface InboxItem {
  file: string;
  bytes: number;
  kind: 'pdf' | 'html' | 'other';
  route: 'public' | 'vault' | 'duplicate' | 'skip';
  reasons: string[];
  duplicateOf?: string;
  title?: string;
  firstPage?: string; // PDF text, to identify broker, company and date
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Hashes of every report already filed, in the public repository and the vault. */
function filedHashes(vault: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const base of [join(ROOT, 'content/reports'), join(vault, 'vault/reports')]) {
    if (!existsSync(base)) continue;
    for (const id of readdirSync(base)) {
      for (const f of ['report.html', 'report.pdf']) {
        const p = join(base, id, f);
        if (existsSync(p)) out.set(sha(p), id);
      }
    }
  }
  return out;
}

function pdfText(path: string): string | undefined {
  try {
    return execFileSync('pdftotext', ['-l', '2', '-layout', path, '-'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] })
      .replace(/[ \t]+/g, ' ')
      .trim()
      .slice(0, 1500);
  } catch {
    return undefined; // pdftotext not installed or unreadable PDF: Claude reads the file directly
  }
}

export function scanInbox(vault: string): InboxItem[] {
  const dir = join(vault, 'inbox');
  if (!existsSync(dir)) return [];
  const filed = filedHashes(vault);
  const items: InboxItem[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (name === 'README.md' || name.startsWith('.') || !statSync(path).isFile()) continue;
    const ext = extname(name).toLowerCase();
    const kind: InboxItem['kind'] = ext === '.pdf' ? 'pdf' : ext === '.html' || ext === '.htm' ? 'html' : 'other';
    const item: InboxItem = { file: `inbox/${name}`, bytes: statSync(path).size, kind, route: 'vault', reasons: [] };
    const dup = filed.get(sha(path));
    if (dup) {
      item.route = 'duplicate';
      item.duplicateOf = dup;
      item.reasons.push(`same file as the filed report ${dup}`);
    } else if (kind === 'pdf') {
      item.route = 'vault';
      item.reasons.push('PDF: sell-side or third-party research stays private');
      item.firstPage = pdfText(path);
    } else if (kind === 'html') {
      const html = readFileSync(path, 'utf8');
      item.title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
      const hits = privacyHits(htmlText(html));
      if (hits.length) {
        item.route = 'vault';
        item.reasons.push(`possible personal information: ${hits.join(', ')}`);
      } else {
        item.route = 'public';
        item.reasons.push('privacy check passed');
      }
    } else {
      item.route = 'skip';
      item.reasons.push('not a PDF or HTML report; left in the inbox for the owner');
    }
    items.push(item);
  }
  return items;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vault = vaultDir()!;
  const items = scanInbox(vault);
  const out = arg('json');
  if (out) writeFileSync(out, JSON.stringify(items, null, 1));
  if (!items.length) console.log('Inbox is empty.');
  for (const it of items) {
    console.log(`${it.route.toUpperCase().padEnd(9)} ${it.file} (${Math.round(it.bytes / 1024)} KB) · ${it.reasons.join('; ')}${it.title ? ` · “${it.title}”` : ''}`);
  }
}

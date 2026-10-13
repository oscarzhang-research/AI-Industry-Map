// Add a research report to the library.
//
//   npm run ingest -- <file.html>                      public Claude report → content/reports/<id>/
//   npm run ingest -- <file.html> --private            private report → vault/reports/<id>/ in the vault clone
//   npm run ingest -- <file.pdf> --broker HSBC         sell-side PDF → always the vault, never the public repo
//
// Options: --id <id>  --date YYYY-MM-DD  --title "English title"  --kind claude|sell-side|other
//          --vault <dir> (default ../AI-Industry-Map-private)  --force-public (skip the privacy check)
//
// Writes report.html|pdf and a meta.yaml skeleton. Fill in companies, nodes, summary.en and stance
// afterwards (Claude does this when asked to "file this report"), then run `npm run validate`.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { stringify } from 'yaml';
import { hasCJK, slugify } from '../src/lib/records.ts';
import type { ReportMeta } from '../src/lib/types.ts';
import { ROOT } from './lib/load.ts';
import { arg, flag, vaultDir, writeFile } from './lib/vaultfs.ts';
import { htmlText, privacyHits } from './lib/privacy.ts';

const VALUE_OPTS = new Set(['--id', '--date', '--title', '--kind', '--vault', '--broker']);
const argv = process.argv.slice(2);
let src: string | undefined;
for (let i = 0; i < argv.length; i++) {
  if (VALUE_OPTS.has(argv[i])) i++;
  else if (!argv[i].startsWith('--')) {
    src = argv[i];
    break;
  }
}
if (!src || !existsSync(src)) {
  console.error('Usage: npm run ingest -- <report.html|report.pdf> [--private] [--broker NAME] [--id ID] [--date YYYY-MM-DD] [--title TITLE]');
  process.exit(2);
}

const isPdf = /\.pdf$/i.test(src);
const broker = arg('broker');
const kind = (arg('kind') as ReportMeta['kind'] | undefined) ?? (isPdf || broker ? 'sell-side' : 'claude');
const html = isPdf ? '' : readFileSync(src, 'utf8');
const fileName = basename(src).replace(/\.(html?|pdf)$/i, '');
const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim();
const title = arg('title') ?? (titleTag && !hasCJK(titleTag) ? titleTag : !hasCJK(fileName) ? fileName.replace(/[_-]+/g, ' ') : '');
const titleZh = titleTag && hasCJK(titleTag) ? titleTag : hasCJK(fileName) ? fileName : undefined;
const dateInName = /(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)/.exec(basename(src));
const date = arg('date') ?? (dateInName ? `${dateInName[1]}-${dateInName[2]}-${dateInName[3]}` : new Date().toISOString().slice(0, 10));
const id = arg('id') ?? `${date}-${slugify(title || fileName || 'report', 48) || 'report'}`;
const toVault = isPdf || kind === 'sell-side' || flag('private');

// Languages: a bilingual report has plenty of both scripts in its text.
const text = htmlText(html);
const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
const latin = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
const languages = isPdf ? [hasCJK(fileName) ? 'zh' : 'en'] : cjk > 200 && latin > 400 ? ['zh', 'en'] : cjk > 200 ? ['zh'] : ['en'];

// Personal details must not reach the public site. Flag likely ones and stop unless forced.
if (!toVault && !flag('force-public')) {
  const hits = privacyHits(text);
  if (hits.length) {
    console.error(`Possible personal information in this report: ${hits.join(', ')}.`);
    console.error('Use --private to keep it in the vault, or --force-public after checking it is safe.');
    process.exit(3);
  }
}

const meta: ReportMeta = {
  id,
  kind,
  visibility: toVault ? 'private' : 'public',
  format: isPdf ? 'pdf' : 'html',
  file: isPdf ? 'report.pdf' : 'report.html',
  title: title || 'TODO: English title',
  ...(titleZh ? { titleZh } : {}),
  date,
  languages,
  companies: [],
  nodes: [],
  tags: [],
  ...(broker ? { broker } : {}),
  ...(!isPdf && /<script(?![^>]*data-aim-shim)/i.test(html) ? { interactive: true } : {}),
  summary: { en: [] },
};

let dir: string;
if (toVault) {
  const vault = vaultDir()!;
  dir = join(vault, 'vault/reports', id);
} else {
  dir = join(ROOT, 'content/reports', id);
}
if (existsSync(join(dir, 'meta.yaml'))) {
  console.error(`${dir} already exists. Pass --id to choose another id.`);
  process.exit(2);
}
writeFile(join(dir, 'meta.yaml'), stringify(meta, { lineWidth: 0 }));
copyFileSync(src, join(dir, meta.file));
console.log(`Filed ${meta.visibility} ${meta.format.toUpperCase()} as ${id}\n  ${dir}`);
console.log('Next: fill in companies, nodes, tags, summary.en (3–5 points) and stance in meta.yaml, then `npm run validate`.');


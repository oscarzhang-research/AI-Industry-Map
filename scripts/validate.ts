// Checks content/ for broken references and misplaced private material.
// Run: node scripts/validate.ts   (exit code 1 on errors; warnings are printed but do not fail)
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadContent, printIssues, ROOT } from './lib/load.ts';
import { privateTerms, reportConcerns } from './lib/privacy.ts';
import { vaultDir } from './lib/vaultfs.ts';

const content = loadContent();
// Public reports are scanned again here, whichever way they arrived (ingest, the upload dialog, a commit by hand).
// A hit is a warning for a person to look at: the scanner cannot tell a company's press contact from a private address.
const terms = privateTerms(vaultDir(false));
for (const r of content.reports) {
  const file = join(r.dir, r.file);
  if (r.format !== 'html' || !existsSync(file)) continue;
  const metaFile = join(r.dir, 'meta.yaml');
  const concerns = reportConcerns(readFileSync(file, 'utf8'), { meta: existsSync(metaFile) ? readFileSync(metaFile, 'utf8') : '', privateTerms: terms });
  if (concerns.length) content.issues.push({ level: 'warn', file: relative(ROOT, file), msg: `check before it stays public: ${concerns.join(', ')}` });
}
const { errors, warnings } = printIssues(content.issues);
const listed = Object.values(content.companies).filter((c) => c.listing === 'listed').length;
console.log(
  `validate: ${content.layers.length} layers, ${content.nodes.size} nodes, ${Object.keys(content.companies).length} companies (${listed} listed), ` +
    `${content.reports.length} reports, ${content.news.length} news, ${content.records.length} records — ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors ? 1 : 0);

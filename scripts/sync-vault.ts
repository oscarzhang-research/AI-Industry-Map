// Rebuild the public copies (content/views) from the private vault clone.
//
//   npm run sync-vault                 write sanitized copies of public records, remove copies of private ones
//   npm run sync-vault -- --check      report differences without writing (exit 1 if any)
//
// Use after editing vault records directly (for example in a Claude session). The site editor does
// this itself on every save. Public copies without a vault original are left alone unless --prune.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { publicProjection, recordPath, serializeRecord } from '../src/lib/records.ts';
import { ROOT } from './lib/load.ts';
import { flag, readRecords, siteConfig, syncPublicCopy, vaultDir } from './lib/vaultfs.ts';

const config = siteConfig();
const vault = vaultDir()!;
const check = flag('check');
const prune = flag('prune');
const records = readRecords(join(vault, 'vault'));
const ids = new Set(records.map((r) => r.rec.id));
let changes = 0;

for (const { rec } of records) {
  const pubFile = join(ROOT, recordPath(rec, 'content/views'));
  if (check) {
    const proj = publicProjection(rec, config.defaults.publicHiddenFields);
    const want = proj ? serializeRecord(proj) : null;
    const have = existsSync(pubFile) ? readFileSync(pubFile, 'utf8') : null;
    if (want !== have) {
      changes++;
      console.log(`${want ? (have ? 'differs' : 'missing') : 'should be removed'}: ${relative(ROOT, pubFile)}`);
    }
    continue;
  }
  const r = syncPublicCopy(rec, config);
  if (r !== 'unchanged') {
    changes++;
    console.log(`${r}: ${relative(ROOT, pubFile)}`);
  }
}

for (const { rec, file } of readRecords(join(ROOT, 'content/views'))) {
  if (ids.has(rec.id) || rec.example) continue;
  if (prune && !check) {
    rmSync(file);
    changes++;
    console.log(`removed orphan: ${relative(ROOT, file)}`);
  } else console.log(`orphan (no vault original): ${relative(ROOT, file)}`);
}

console.log(`${records.length} vault record(s), ${changes} change(s)${check ? ' needed' : ''}.`);
if (check && changes) process.exit(1);

// Translation queue for records written in Chinese.
//
//   npm run translate-queue                       list what needs an English version (vault + public)
//   npm run translate-queue -- --json out.json    write the source text of every pending field to a file
//   npm run translate-queue -- --apply in.json    store translations: { "<record id>": { "<field key>": "English", … } }
//
// The source text is hashed when a translation is stored, so a later edit marks it stale again.
// Public copies in content/views are refreshed for public records. Run from the public repository;
// the vault clone defaults to ../AI-Industry-Map-private (or --vault <dir>).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { recordLanguage, serializeRecord, sourceHash, translatableFields, translationState } from '../src/lib/records.ts';
import type { AnyRecord } from '../src/lib/types.ts';
import { ROOT } from './lib/load.ts';
import { arg, readRecords, siteConfig, syncPublicCopy, vaultDir, writeFile } from './lib/vaultfs.ts';

const config = siteConfig();
const vault = vaultDir(false);
const sources = [
  ...(vault ? readRecords(join(vault, 'vault')).map((x) => ({ ...x, where: 'vault' as const })) : []),
  ...readRecords(join(ROOT, 'content/views')).map((x) => ({ ...x, where: 'public' as const })),
];
// A record in the vault is the original; its public copy is regenerated from it.
const byId = new Map<string, (typeof sources)[number]>();
for (const s of sources) if (!byId.has(s.rec.id) || s.where === 'vault') byId.set(s.rec.id, s);

const pending = [...byId.values()].filter(({ rec }) => recordLanguage(rec) === 'zh' && translationState(rec) !== 'translated');

const applyFile = arg('apply');
if (applyFile) {
  const input = JSON.parse(readFileSync(applyFile, 'utf8')) as Record<string, Record<string, string>>;
  let n = 0;
  for (const [id, fields] of Object.entries(input)) {
    const entry = byId.get(id);
    if (!entry) {
      console.warn(`skip ${id}: no such record`);
      continue;
    }
    const rec = entry.rec as AnyRecord;
    const source = translatableFields(rec);
    const unknown = Object.keys(fields).filter((k) => !(k in source));
    if (unknown.length) console.warn(`${id}: ignoring unknown field keys ${unknown.join(', ')}`);
    const kept = Object.fromEntries(Object.entries(fields).filter(([k, v]) => k in source && v.trim()));
    const missing = Object.keys(source).filter((k) => !(k in kept));
    if (missing.length) console.warn(`${id}: no English for ${missing.join(', ')} (shown in the original language)`);
    rec.translation = { lang: 'en', fields: kept, sourceHash: sourceHash(source), translatedAt: new Date().toISOString(), by: 'claude' };
    writeFile(entry.file, serializeRecord(rec));
    if (entry.where === 'vault') {
      const r = syncPublicCopy(rec, config);
      if (r !== 'unchanged') console.log(`  public copy ${r}`);
    }
    console.log(`translated ${id} (${Object.keys(kept).length} fields) → ${relative(process.cwd(), entry.file)}`);
    n++;
  }
  console.log(`${n} record(s) updated. Commit the vault and the public repository.`);
} else {
  const out = Object.fromEntries(
    pending.map(({ rec }) => {
      const fields = translatableFields(rec);
      const old = rec.translation?.fields ?? {};
      return [rec.id, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { source: v, previous: old[k] }]))];
    }),
  );
  const jsonFile = arg('json');
  if (jsonFile) {
    writeFileSync(jsonFile, JSON.stringify(out, null, 2));
    console.log(`${pending.length} record(s) need English; source text written to ${jsonFile}`);
  } else {
    for (const { rec, where } of pending) console.log(`${translationState(rec).padEnd(7)} ${where.padEnd(6)} ${rec.type.padEnd(7)} ${rec.id}  ${rec.title ?? ''}`);
    console.log(`${pending.length} record(s) need English${vault ? '' : ' (vault clone not found: public records only)'}.`);
  }
}

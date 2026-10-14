// Daily check of the site's automated parts: market data, news, the feeds branch, indicators and workflows.
// Run: node scripts/health.ts [--runs runs.json] [--feeds-dir dir] [--now ISO]
//   --runs       output of `gh run list --json name,conclusion,createdAt,url,event,status`
//   --feeds-dir  a folder holding news-candidates.json and sources-status.json from the feeds branch
// Prints a Markdown report. Exit code 1 means something needs attention (.github/workflows/health.yml then
// opens or updates the "site-health" issue, which GitHub emails to the owner); warnings alone exit 0.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeSymbol } from '../src/lib/symbols.ts';
import { loadContent, ROOT } from './lib/load.ts';
import { arg } from './lib/vaultfs.ts';

type Level = 'ok' | 'warn' | 'problem';
interface Finding {
  area: string;
  level: Level;
  text: string;
}

const now = arg('now') ? new Date(arg('now')!) : new Date();
const DATA = join(ROOT, 'data');
const findings: Finding[] = [];
const add = (area: string, level: Level, text: string) => findings.push({ area, level, text });

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

const hoursSince = (iso: string | undefined) => (iso ? Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3.6e6) : Infinity);
const fmtAge = (h: number) => (h === Infinity ? 'never' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`);
const list = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));

// ---- Market data ------------------------------------------------------------------
// Prices change on weekdays. On Sunday and Monday (UTC) the newest data can be from Friday evening.
const status = readJson<{ updatedAt?: string; symbols?: number; ok?: number; failed?: string[]; fundamentalsFailed?: string[]; earningsFailed?: string[] }>(
  join(DATA, 'status.json'),
);
const day = now.getUTCDay();
const maxAge = day === 0 || day === 1 ? 78 : 30;
const age = hoursSince(status?.updatedAt);
if (age > maxAge) add('Market data', 'problem', `Last update ${fmtAge(age)} (expected within ${maxAge} hours).`);
else add('Market data', 'ok', `Last update ${fmtAge(age)}.`);
const failed = status?.failed ?? [];
if (failed.length > Math.max(5, 0.05 * (status?.symbols ?? 0))) add('Market data', 'problem', `${failed.length} price series failed: ${list(failed)}.`);
else if (failed.length) add('Market data', 'warn', `${failed.length} price series failed in the last run: ${list(failed)}.`);
const fundFailed = status?.fundamentalsFailed ?? [];
if (fundFailed.length > 30) add('Market data', 'warn', `Valuation data missing for ${fundFailed.length} companies: ${list(fundFailed)}.`);
if ((status?.earningsFailed ?? []).length) add('Market data', 'warn', `Earnings data failed for ${list(status!.earningsFailed!)}.`);

// Series that stopped updating while the rest moved on: usually a delisting or a changed ticker.
const priceDir = join(DATA, 'prices');
if (existsSync(priceDir)) {
  const last = new Map<string, string>();
  for (const f of readdirSync(priceDir).filter((x) => x.endsWith('.csv'))) {
    const lines = readFileSync(join(priceDir, f), 'utf8').trim().split('\n');
    const d = lines[lines.length - 1]?.split(',')[0];
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) last.set(f.slice(0, -4), d);
  }
  const newest = [...last.values()].sort().pop();
  if (newest) {
    const cutoff = new Date(new Date(newest).getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const stale = [...last].filter(([, d]) => d < cutoff).map(([s, d]) => `${s} (${d})`);
    if (stale.length) add('Market data', 'warn', `No new prices for over a week: ${list(stale)}. Check the ticker.`);
  }
}

// Benchmarks are long-established indices or funds, so a short history means Yahoo has stopped carrying
// the symbol's daily data (as it did for the CSI 300 and STAR 50 indices) and relative returns go blank.
const content = loadContent();
const shortBench = content.benchmarks.flatMap((b) => {
  const f = join(priceDir, `${safeSymbol(b.symbol)}.csv`);
  const days = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').length - 1 : 0;
  return days < 250 ? [`${b.name} (${b.symbol}, ${days} days)`] : [];
});
if (shortBench.length) add('Market data', 'warn', `Benchmarks with less than a year of daily prices: ${list(shortBench)}. Returns against them are missing.`);

// ---- News ----------------------------------------------------------------------------
const latestNews = content.news[0]?.date;
const newsAge = latestNews ? (now.getTime() - new Date(`${latestNews}T23:59:59Z`).getTime()) / 864e5 : Infinity;
if (newsAge > 2) add('News', 'problem', `Newest item is from ${latestNews ?? 'never'}; the morning routine adds news every day.`);
else add('News', 'ok', `Newest item from ${latestNews}.`);

// ---- Feeds branch ------------------------------------------------------------------------
const feedsDir = arg('feeds-dir');
if (feedsDir) {
  const cand = readJson<{ generatedAt?: string; items?: unknown[] }>(join(feedsDir, 'news-candidates.json'));
  const fage = hoursSince(cand?.generatedAt);
  if (fage > 8) add('News feeds', 'problem', `Candidates last refreshed ${fmtAge(fage)} (every two hours expected).`);
  else add('News feeds', 'ok', `${cand?.items?.length ?? 0} candidates, refreshed ${fmtAge(fage)}.`);
  const src = readJson<Record<string, { ok: boolean; skipped?: boolean; status?: unknown }>>(join(feedsDir, 'sources-status.json')) ?? {};
  const skipped = Object.entries(src).filter(([, s]) => s.skipped);
  const tried = Object.entries(src).filter(([, s]) => !s.skipped);
  const bad = tried.filter(([, s]) => !s.ok);
  if (bad.length && bad.length >= tried.length / 2) add('News feeds', 'problem', `${bad.length} of ${tried.length} sources failed.`);
  else if (bad.length) add('News feeds', 'warn', `${bad.length} sources failed: ${list(bad.map(([id, s]) => `${id} (${String(s.status ?? 'error')})`))}.`);
  if (skipped.length) add('News feeds', 'warn', `${skipped.length} SEC filing feeds are off until the repository secret SEC_USER_AGENT is set.`);
}

// ---- Indicators ------------------------------------------------------------------------------
const kpi = readJson<{ updatedAt?: string; sec?: { failed?: string[]; skipped?: unknown }; tw?: { failed?: string[] } }>(join(DATA, 'kpis', 'status.json'));
if (kpi) {
  const kage = hoursSince(kpi.updatedAt);
  if (kage > 96) add('Indicators', 'warn', `Last refreshed ${fmtAge(kage)}.`);
  else add('Indicators', 'ok', `Refreshed ${fmtAge(kage)}.`);
  const kf = [...(kpi.sec?.failed ?? []), ...(kpi.tw?.failed ?? [])];
  if (kf.length) add('Indicators', 'warn', `Failed: ${list(kf)}.`);
  if (typeof kpi.sec?.skipped === 'string') add('Indicators', 'warn', 'SEC figures are off until the repository secret SEC_USER_AGENT is set.');
}

// ---- Workflows ---------------------------------------------------------------------------------
const runsPath = arg('runs');
if (runsPath) {
  const runs = readJson<{ name: string; conclusion: string; createdAt: string; url: string; event: string }[]>(runsPath) ?? [];
  const recent = runs.filter((r) => hoursSince(r.createdAt) <= 26);
  const bad = recent.filter((r) => r.conclusion === 'failure');
  // A failure followed by a success of the same workflow has already recovered.
  const unresolved = bad.filter((b) => !recent.some((r) => r.name === b.name && r.conclusion === 'success' && r.createdAt > b.createdAt));
  for (const r of unresolved) add('Workflows', 'problem', `[${r.name}](${r.url}) failed (${r.event}, ${r.createdAt.slice(0, 16).replace('T', ' ')} UTC).`);
  if (!unresolved.length) add('Workflows', 'ok', `${recent.length} runs on main in the last day, none still failing.`);
}

// ---- Report ------------------------------------------------------------------------------------------
const icon: Record<Level, string> = { ok: '✅', warn: '⚠️', problem: '❌' };
const problems = findings.filter((f) => f.level === 'problem');
const signature = createHash('sha1')
  .update(findings.filter((f) => f.level !== 'ok').map((f) => `${f.area}|${f.text.replace(/\d+ (hours|days) ago/g, '')}`).join('\n'))
  .digest('hex')
  .slice(0, 12);
const out: string[] = [`## Site health · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
out.push(problems.length ? `**${problems.length} problem(s) need attention.**` : 'Everything that matters is working.', '');
for (const area of [...new Set(findings.map((f) => f.area))]) {
  out.push(`### ${area}`);
  for (const f of findings.filter((x) => x.area === area)) out.push(`- ${icon[f.level]} ${f.text}`);
  out.push('');
}
out.push(`<!-- signature: ${signature} -->`);
console.log(out.join('\n'));
process.exit(problems.length ? 1 : 0);

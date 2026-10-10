// Compiles content/ and data/ into public/generated/ for the web app.
// Run: node scripts/build-data.ts   (also runs automatically before `vite` and `vite build`)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent, printIssues, ROOT } from './lib/load.ts';
import { basketIndex, computeQuote, parsePriceCsv, AI_BASE_DATE, type Fundamentals } from '../src/lib/finance.ts';
import { safeSymbol } from '../src/lib/symbols.ts';
import { htmlToText, injectReaderShim } from '../src/lib/reportShim.ts';
import type { IndexSeries, PriceSeries, Quote, QuotesFile, SiteData } from '../src/lib/types.ts';

const OUT = join(ROOT, 'public/generated');
const DATA = join(ROOT, 'data');

function writeJson(path: string, obj: unknown) {
  writeFileSync(path, JSON.stringify(obj));
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const t0 = Date.now();
const content = loadContent();
const { errors, warnings } = printIssues(content.issues, true);
if (errors) {
  console.error(`build-data: ${errors} error(s); fix them (npm run validate) before building.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'prices'), { recursive: true });
mkdirSync(join(OUT, 'reports'), { recursive: true });

// ---- Site ---------------------------------------------------------------------
const site: SiteData = {
  generatedAt: new Date().toISOString(),
  config: content.config,
  layers: content.layers,
  companies: content.companies,
  themes: content.themes,
  ecosystems: content.ecosystems,
  benchmarks: content.benchmarks,
  benchmarkDefaults: content.benchmarkDefaults,
  events: content.events,
};
writeJson(join(OUT, 'site.json'), site);

// ---- Prices & quotes ----------------------------------------------------------------
const splits = readJson<Record<string, [string, number][]>>(join(DATA, 'splits.json'), {});
const fundamentals = readJson<Record<string, Fundamentals>>(join(DATA, 'fundamentals.json'), {});
const fxDoc = readJson<{ asOf?: string; rates?: Record<string, number> }>(join(DATA, 'fx.json'), {});
const status = readJson<{ updatedAt?: string }>(join(DATA, 'status.json'), {});
const fx = { USD: 1, ...(fxDoc.rates ?? {}) };

const currencyOf = new Map<string, string>();
for (const c of Object.values(content.companies)) for (const t of c.tickers) if (t.currency) currencyOf.set(t.symbol, t.currency);
for (const b of content.benchmarks) if (b.currency) currencyOf.set(b.symbol, b.currency);

const series = new Map<string, PriceSeries>();
const priceDir = join(DATA, 'prices');
const wanted = new Set<string>([
  ...Object.values(content.companies).flatMap((c) => c.tickers.map((t) => t.symbol)),
  ...content.benchmarks.map((b) => b.symbol),
  ...content.extraSymbols,
]);
const bySafe = new Map([...wanted].map((s) => [safeSymbol(s), s]));
if (existsSync(priceDir)) {
  for (const f of readdirSync(priceDir).filter((x) => x.endsWith('.csv'))) {
    const symbol = bySafe.get(f.slice(0, -4));
    if (!symbol) continue; // data for a symbol no longer in the universe
    const s = parsePriceCsv(symbol, readFileSync(join(priceDir, f), 'utf8'));
    if (!s.c.length) continue;
    if (splits[symbol]?.length) s.splits = splits[symbol];
    series.set(symbol, s);
    writeJson(join(OUT, 'prices', `${safeSymbol(symbol)}.json`), s);
  }
}

const quotes: Record<string, Quote> = {};
let asOf: string | null = null;
for (const [symbol, s] of series) {
  const q = computeQuote(s, fundamentals[symbol], fx, currencyOf.get(symbol));
  if (!q) continue;
  quotes[symbol] = q;
  if (!asOf || q.d > asOf) asOf = q.d;
}
const quotesFile: QuotesFile = { updatedAt: status.updatedAt ?? null, asOf, quotes, fx };
writeJson(join(OUT, 'quotes.json'), quotesFile);

// ---- Baskets: equal-weight indices for layers and industries -----------------------
const indexSeries: IndexSeries[] = [];
function basketFor(ids: string[]): PriceSeries[] {
  const out: PriceSeries[] = [];
  for (const id of new Set(ids)) {
    const c = content.companies[id];
    if (c?.listing === 'listed' && c.symbol && series.has(c.symbol)) out.push(series.get(c.symbol)!);
  }
  return out;
}
for (const layer of content.layers) {
  const members = Object.values(content.companies).filter((c) => c.layers.includes(layer.id) && c.tier !== 'watch').map((c) => c.id);
  const list = basketFor(members);
  const idx = basketIndex(list, AI_BASE_DATE);
  if (idx.d.length > 1) indexSeries.push({ id: layer.id, kind: 'layer', name: layer.name, members: list.length, ...idx });
  for (const ind of layer.industries) {
    const ilist = basketFor(ind.segments.flatMap((s) => s.companies));
    const iidx = basketIndex(ilist, AI_BASE_DATE);
    if (iidx.d.length > 1) indexSeries.push({ id: ind.path, kind: 'industry', name: ind.name, members: ilist.length, ...iidx });
  }
}
for (const theme of content.themes) {
  const tlist = basketFor(theme.companies);
  const tidx = basketIndex(tlist, AI_BASE_DATE);
  if (tidx.d.length > 1) indexSeries.push({ id: theme.id, kind: 'theme', name: theme.name, members: tlist.length, ...tidx });
}
writeJson(join(OUT, 'indices.json'), { base: AI_BASE_DATE, series: indexSeries });

// ---- Reports: served copies with the reader shim, metadata and search text -----------
const reportText: Record<string, string> = {};
const reportsOut = content.reports.map(({ dir, ...meta }) => {
  const html = readFileSync(join(dir, meta.file), 'utf8');
  writeFileSync(join(OUT, 'reports', `${meta.id}.html`), injectReaderShim(html));
  reportText[meta.id] = htmlToText(html);
  return { ...meta, url: `generated/reports/${meta.id}.html`, origin: 'public' as const };
});
writeJson(join(OUT, 'reports.json'), reportsOut);
writeJson(join(OUT, 'reports-text.json'), reportText);

// ---- News, records ------------------------------------------------------------
writeJson(join(OUT, 'news.json'), content.news);
writeJson(join(OUT, 'records.json'), { records: content.records });

// ---- Meta + robots -----------------------------------------------------------------
writeJson(join(OUT, 'meta.json'), {
  generatedAt: site.generatedAt,
  dataUpdatedAt: status.updatedAt ?? null,
  pricesAsOf: asOf,
  counts: {
    companies: Object.keys(content.companies).length,
    listed: Object.values(content.companies).filter((c) => c.listing === 'listed').length,
    series: series.size,
    reports: reportsOut.length,
    news: content.news.length,
    records: content.records.length,
  },
});
writeFileSync(
  join(ROOT, 'public/robots.txt'),
  content.config.site.experimental ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n',
);

console.log(
  `build-data: ${Object.keys(content.companies).length} companies, ${series.size} price series (as of ${asOf ?? 'n/a'}), ` +
    `${indexSeries.length} baskets, ${reportsOut.length} reports, ${content.news.length} news, ${content.records.length} records` +
    ` · ${warnings} warning(s) · ${Date.now() - t0} ms`,
);

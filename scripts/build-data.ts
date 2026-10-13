// Compiles content/ and data/ into public/generated/ for the web app.
// Run: node scripts/build-data.ts   (also runs automatically before `vite` and `vite build`)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent, printIssues, ROOT } from './lib/load.ts';
import { basketIndex, capWeightIndex, computeQuote, earningsMove, parsePriceCsv, parseValuationCsv, revenueSurprise, AI_BASE_DATE, type Fundamentals } from '../src/lib/finance.ts';
import { priceChunk, safeSymbol } from '../src/lib/symbols.ts';
import { htmlToText, injectReaderShim } from '../src/lib/reportShim.ts';
import type { EarningsFile, EarningsRecord, IndexSeries, PriceSeries, Quote, QuotesFile, SiteData } from '../src/lib/types.ts';

const OUT = join(ROOT, 'public/generated');
const DATA = join(ROOT, 'data');
// PRICE_CHUNKS=N packs price series into N files instead of one per symbol (for hosts with file limits).
const PRICE_CHUNKS = Math.max(0, Number(process.env.PRICE_CHUNKS ?? 0) | 0);

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
const valDir = join(DATA, 'valuation');
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
    const valFile = join(valDir, f);
    if (existsSync(valFile)) {
      const val = parseValuationCsv(readFileSync(valFile, 'utf8'));
      if (val.d.length) s.val = val;
    }
    series.set(symbol, s);
    if (!PRICE_CHUNKS) writeJson(join(OUT, 'prices', `${safeSymbol(symbol)}.json`), s);
  }
}
if (PRICE_CHUNKS) {
  const packs: Record<string, PriceSeries>[] = Array.from({ length: PRICE_CHUNKS }, () => ({}));
  for (const [symbol, s] of series) packs[priceChunk(symbol, PRICE_CHUNKS)][symbol] = s;
  packs.forEach((p, i) => writeJson(join(OUT, 'prices', `chunk-${i}.json`), p));
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

// ---- Earnings ------------------------------------------------------------------------------------------
// Consensus and results from data/earnings.json, with the share price reaction and the revenue surprise.
// Revenue figures that look like a different currency from the estimate (ADRs, cross-listings) are dropped.
const earningsRaw = readJson<EarningsFile>(join(DATA, 'earnings.json'), {});
const earnings: EarningsFile = {};
for (const [symbol, rec] of Object.entries(earningsRaw)) {
  if (!wanted.has(symbol) || !rec) continue;
  const s = series.get(symbol);
  const history = (rec.history ?? []).map((h) => {
    const out = { ...h, move: earningsMove(s, h.date), revSurprise: revenueSurprise(h) };
    if (h.revEst && h.revActual && out.revSurprise === undefined) delete out.revEst;
    return out;
  });
  const out: EarningsRecord = { updatedAt: rec.updatedAt, ccy: fundamentals[symbol]?.financialCurrency, history };
  if (rec.next) {
    out.next = { ...rec.next };
    const lastRev = history.find((h) => h.revActual)?.revActual;
    if (out.next.revEst && lastRev && !(out.next.revEst / lastRev > 0.4 && out.next.revEst / lastRev < 2.5)) delete out.next.revEst;
  }
  earnings[symbol] = out;
}
writeJson(join(OUT, 'earnings.json'), earnings);

// ---- Indices -------------------------------------------------------------------------------------------
// Layers: market-cap-weighted (where the money went), each company counted once in its primary layer, plus an
// equal-weight variant of the same companies (core and focus tiers). Industries and themes: equal-weight
// baskets of every listed company placed there, so conglomerates do not swamp narrow niches.
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
  const primary = Object.values(content.companies).filter((c) => c.primaryLayer === layer.id && c.listing === 'listed' && c.symbol && series.has(c.symbol));
  const capMembers = primary
    .map((c) => ({ series: series.get(c.symbol!)!, mcap: quotes[c.symbol!]?.mcapUsd ?? 0 }))
    .filter((m) => m.mcap > 0);
  const cap = capWeightIndex(capMembers, AI_BASE_DATE);
  if (cap.d.length > 1) indexSeries.push({ id: layer.id, kind: 'layer', weighting: 'cap', name: layer.name, members: capMembers.length, d: cap.d, v: cap.v, top: cap.top });
  const eq = basketFor(primary.filter((c) => c.tier !== 'watch').map((c) => c.id));
  const eidx = basketIndex(eq, AI_BASE_DATE);
  if (eidx.d.length > 1) indexSeries.push({ id: layer.id, kind: 'layer-equal', weighting: 'equal', name: layer.name, members: eq.length, ...eidx });
  for (const ind of layer.industries) {
    const ilist = basketFor(ind.segments.flatMap((s) => s.companies));
    const iidx = basketIndex(ilist, AI_BASE_DATE);
    if (iidx.d.length > 1) indexSeries.push({ id: ind.path, kind: 'industry', weighting: 'equal', name: ind.name, members: ilist.length, ...iidx });
  }
}
for (const theme of content.themes) {
  const tlist = basketFor(theme.companies);
  const tidx = basketIndex(tlist, AI_BASE_DATE);
  if (tidx.d.length > 1) indexSeries.push({ id: theme.id, kind: 'theme', weighting: 'equal', name: theme.name, members: tlist.length, ...tidx });
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
// Placeholder records (example: true) are validated but only shipped while showExamples is on.
const records = content.records.filter((r) => content.config.site.showExamples || !r.example);
writeJson(join(OUT, 'records.json'), { records });

// ---- Meta + robots -----------------------------------------------------------------
writeJson(join(OUT, 'meta.json'), {
  generatedAt: site.generatedAt,
  priceChunks: PRICE_CHUNKS || undefined,
  dataUpdatedAt: status.updatedAt ?? null,
  pricesAsOf: asOf,
  counts: {
    companies: Object.keys(content.companies).length,
    listed: Object.values(content.companies).filter((c) => c.listing === 'listed').length,
    series: series.size,
    reports: reportsOut.length,
    news: content.news.length,
    records: records.length,
    earnings: Object.keys(earnings).length,
    valuationHistory: [...series.values()].filter((x) => x.val).length,
  },
});
writeFileSync(
  join(ROOT, 'public/robots.txt'),
  content.config.site.experimental ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n',
);

console.log(
  `build-data: ${Object.keys(content.companies).length} companies, ${series.size} price series (as of ${asOf ?? 'n/a'}), ` +
    `${indexSeries.length} baskets, ${reportsOut.length} reports, ${content.news.length} news, ${records.length} records` +
    ` · ${warnings} warning(s) · ${Date.now() - t0} ms`,
);

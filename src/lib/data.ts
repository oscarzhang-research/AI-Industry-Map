// Loading of the generated JSON files (public/generated/*), with small in-memory caches.
import type { EarningsFile, IndicesFile, NewsItem, PriceSeries, QuotesFile, RecordsFile, ReportMeta, SiteData } from './types.ts';
import { priceChunk, safeSymbol } from './symbols.ts';

export interface Meta {
  generatedAt: string;
  priceChunks?: number; // prices packed into prices/chunk-<n>.json
  dataUpdatedAt: string | null;
  pricesAsOf: string | null;
  counts: Record<string, number>;
}

export interface CoreData {
  site: SiteData;
  quotes: QuotesFile;
  reports: ReportMeta[];
  news: NewsItem[];
  records: RecordsFile;
  meta: Meta;
}

const BASE = 'generated/';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadCore(): Promise<CoreData> {
  const [site, quotes, reports, news, records, meta] = await Promise.all([
    getJson<SiteData>('site.json'),
    getJson<QuotesFile>('quotes.json'),
    getJson<ReportMeta[]>('reports.json'),
    getJson<NewsItem[]>('news.json'),
    getJson<RecordsFile>('records.json'),
    getJson<Meta>('meta.json'),
  ]);
  priceChunks = meta.priceChunks ?? 0;
  return { site, quotes, reports, news, records, meta };
}

let priceChunks = 0;
const chunkCache = new Map<number, Promise<Record<string, PriceSeries>>>();

const seriesCache = new Map<string, Promise<PriceSeries | undefined>>();

export function loadSeries(symbol: string | undefined): Promise<PriceSeries | undefined> {
  if (!symbol) return Promise.resolve(undefined);
  let p = seriesCache.get(symbol);
  if (!p) {
    if (priceChunks) {
      const n = priceChunk(symbol, priceChunks);
      let pack = chunkCache.get(n);
      if (!pack) {
        pack = getJson<Record<string, PriceSeries>>(`prices/chunk-${n}.json`).catch(() => ({}));
        chunkCache.set(n, pack);
      }
      p = pack.then((all) => all[symbol]);
    } else {
      p = getJson<PriceSeries>(`prices/${safeSymbol(symbol)}.json`).catch(() => undefined);
    }
    seriesCache.set(symbol, p);
  }
  return p;
}

let indicesPromise: Promise<IndicesFile> | null = null;
export function loadIndices(): Promise<IndicesFile> {
  indicesPromise ??= getJson<IndicesFile>('indices.json').catch(() => ({ base: '', series: [] }));
  return indicesPromise;
}

let textPromise: Promise<Record<string, string>> | null = null;
export function loadReportText(): Promise<Record<string, string>> {
  textPromise ??= getJson<Record<string, string>>('reports-text.json').catch(() => ({}));
  return textPromise;
}

let earningsPromise: Promise<EarningsFile> | null = null;
export function loadEarnings(): Promise<EarningsFile> {
  earningsPromise ??= getJson<EarningsFile>('earnings.json').catch(() => ({}));
  return earningsPromise;
}

// Loading of the generated JSON files (public/generated/*), with small in-memory caches.
import type { IndicesFile, NewsItem, PriceSeries, QuotesFile, RecordsFile, ReportMeta, SiteData } from './types.ts';
import { safeSymbol } from './symbols.ts';

export interface Meta {
  generatedAt: string;
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
  return { site, quotes, reports, news, records, meta };
}

const seriesCache = new Map<string, Promise<PriceSeries | undefined>>();

export function loadSeries(symbol: string | undefined): Promise<PriceSeries | undefined> {
  if (!symbol) return Promise.resolve(undefined);
  let p = seriesCache.get(symbol);
  if (!p) {
    p = getJson<PriceSeries>(`prices/${safeSymbol(symbol)}.json`).catch(() => undefined);
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

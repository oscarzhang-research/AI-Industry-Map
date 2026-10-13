// Read the compiled site data (public/generated/, written by `npm run build-data`) from Node scripts.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EarningsFile, IndicesFile, KpisFile, NewsItem, PriceSeries, QuotesFile, SiteData } from '../../src/lib/types.ts';
import { safeSymbol } from '../../src/lib/symbols.ts';
import { ROOT } from './load.ts';

export interface Generated {
  site: SiteData;
  quotes: QuotesFile;
  indices: IndicesFile;
  earnings: EarningsFile;
  kpis: KpisFile;
  news: NewsItem[];
  series: (symbol: string) => PriceSeries | undefined;
}

export function loadGenerated(dir = join(ROOT, 'public/generated')): Generated {
  if (!existsSync(join(dir, 'site.json'))) {
    console.error(`No compiled data in ${dir}. Run \`npm run build-data\` first.`);
    process.exit(2);
  }
  const read = <T>(name: string, fallback: T): T => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
    } catch {
      return fallback;
    }
  };
  const cache = new Map<string, PriceSeries | undefined>();
  return {
    site: read<SiteData>('site.json', undefined as unknown as SiteData),
    quotes: read<QuotesFile>('quotes.json', { updatedAt: null, asOf: null, quotes: {}, fx: {} }),
    indices: read<IndicesFile>('indices.json', { base: '', series: [] }),
    earnings: read<EarningsFile>('earnings.json', {}),
    kpis: read<KpisFile>('kpis.json', { updatedAt: null, indicators: [] }),
    news: read<NewsItem[]>('news.json', []),
    series: (symbol: string) => {
      if (!cache.has(symbol)) cache.set(symbol, read<PriceSeries | undefined>(join('prices', `${safeSymbol(symbol)}.json`), undefined));
      return cache.get(symbol);
    },
  };
}

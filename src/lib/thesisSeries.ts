// Which price series tracks a thesis: shared by the app (useThesis.ts) and the owner scripts in Node.
import type { IndexSeries, IndicesFile, PriceSeries, SiteData, ThesisRecord } from './types.ts';
import { thesisBenchmark, thesisSymbol } from './views.ts';

export function indexToSeries(s: IndexSeries): PriceSeries {
  return { s: `basket:${s.id}`, d: s.d, c: s.v, h: s.v, l: s.v };
}

/** The basket that tracks a node or theme view (segments roll up to their industry). */
export function thesisBasket(t: ThesisRecord, indices: IndicesFile | null): IndexSeries | undefined {
  if (!indices) return undefined;
  const s = t.subject;
  if (s?.kind === 'node' && s.node) {
    const parts = s.node.split('/');
    const id = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
    const kind = parts.length > 1 ? 'industry' : 'layer';
    return indices.series.find((x) => x.kind === kind && x.id === id);
  }
  if (s?.kind === 'theme' && s.theme) return indices.series.find((x) => x.kind === 'theme' && x.id === s.theme);
  return undefined;
}

export interface ThesisSeries {
  series?: PriceSeries;
  bench?: PriceSeries;
  symbol?: string; // listing symbol, or undefined for a basket
  benchSymbol?: string;
  basket?: IndexSeries;
}

/** The same lookup as useThesisSeries, for scripts that already hold the series. */
export function thesisSeriesFrom(t: ThesisRecord, site: SiteData, indices: IndicesFile | null, get: (symbol: string) => PriceSeries | undefined): ThesisSeries {
  const symbol = thesisSymbol(t, site);
  const benchSymbol = thesisBenchmark(t, site);
  const basket = symbol ? undefined : thesisBasket(t, indices);
  return {
    symbol,
    benchSymbol,
    basket,
    series: symbol ? get(symbol) : basket ? indexToSeries(basket) : undefined,
    bench: benchSymbol ? get(benchSymbol) : undefined,
  };
}

// Price data for theses: a listing (company views, or a proxy ETF) or, for views without a proxy, an index
// built at compile time (public/generated/indices.json): the market-cap-weighted index for a layer, the
// equal-weight basket for an industry, segment or theme.
import { useCallback } from 'react';
import type { IndexSeries, IndicesFile, PriceSeries, SiteData, ThesisRecord } from './types.ts';
import { useIndices, useSeriesMany } from './hooks.ts';
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

/** Loads every series the given theses need; returns a lookup by thesis. */
export function useThesisSeries(theses: ThesisRecord[], site: SiteData): (t: ThesisRecord) => ThesisSeries {
  const map = useSeriesMany(theses.flatMap((t) => [thesisSymbol(t, site), thesisBenchmark(t, site)]));
  const indices = useIndices();
  return useCallback(
    (t: ThesisRecord) => {
      const symbol = thesisSymbol(t, site);
      const benchSymbol = thesisBenchmark(t, site);
      const basket = symbol ? undefined : thesisBasket(t, indices);
      return {
        symbol,
        benchSymbol,
        basket,
        series: symbol ? map.get(symbol) : basket ? indexToSeries(basket) : undefined,
        bench: benchSymbol ? map.get(benchSymbol) : undefined,
      };
    },
    [map, indices, site],
  );
}

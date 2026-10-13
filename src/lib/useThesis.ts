// Price data for theses: a listing (company views, or a proxy ETF) or, for views without a proxy, an index
// built at compile time (public/generated/indices.json): the market-cap-weighted index for a layer, the
// equal-weight basket for an industry, segment or theme.
import { useCallback } from 'react';
import type { SiteData, ThesisRecord } from './types.ts';
import { useIndices, useSeriesMany } from './hooks.ts';
import { thesisBenchmark, thesisSymbol } from './views.ts';
import { indexToSeries, thesisBasket, type ThesisSeries } from './thesisSeries.ts';

export { indexToSeries, thesisBasket, type ThesisSeries };

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

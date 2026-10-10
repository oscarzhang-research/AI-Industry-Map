import type { Market } from './types.ts';

/** File-system safe name for a symbol. Must match safe_symbol() in scripts/prices/fetch_prices.py. */
export function safeSymbol(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9.\-]/g, '_');
}

const SUFFIX_MARKETS: [string, Market][] = [
  ['.TWO', 'TW'],
  ['.TW', 'TW'],
  ['.KS', 'KR'],
  ['.KQ', 'KR'],
  ['.T', 'JP'],
  ['.HK', 'HK'],
  ['.SS', 'CN'],
  ['.SZ', 'CN'],
  ['.AS', 'EU'],
  ['.PA', 'EU'],
  ['.MI', 'EU'],
  ['.DE', 'EU'],
  ['.VI', 'EU'],
  ['.MC', 'EU'],
  ['.BR', 'EU'],
  ['.L', 'UK'],
  ['.SW', 'CH'],
  ['.CO', 'NORDIC'],
  ['.HE', 'NORDIC'],
  ['.ST', 'NORDIC'],
  ['.OL', 'NORDIC'],
  ['.AX', 'AU'],
  ['.TO', 'CA'],
];

export function marketOf(symbol: string | undefined): Market {
  if (!symbol) return 'OTHER';
  if (symbol.startsWith('^')) return 'OTHER';
  for (const [suffix, market] of SUFFIX_MARKETS) {
    if (symbol.endsWith(suffix)) return market;
  }
  return /^[A-Z][A-Z0-9.\-]*$/.test(symbol) ? 'US' : 'OTHER';
}

export const MARKET_LABEL: Record<Market, string> = {
  US: 'US',
  TW: 'Taiwan',
  KR: 'Korea',
  JP: 'Japan',
  HK: 'Hong Kong',
  CN: 'China A',
  EU: 'Europe',
  UK: 'UK',
  CH: 'Switzerland',
  NORDIC: 'Nordics',
  AU: 'Australia',
  CA: 'Canada',
  OTHER: 'Other',
};

/** Benchmark id for a listing, using the defaults in content/benchmarks.yaml. */
export function benchmarkIdFor(symbol: string | undefined, layer: string | undefined, defaults: Record<string, string>): string {
  // Baskets (industry, layer or theme views without a proxy) are mostly US-listed: use the US defaults.
  if (!symbol || symbol.startsWith('basket:')) return (layer === 'chips' && defaults['US-chips']) || defaults.US || 'spx';
  const m = marketOf(symbol);
  if (m === 'US') return (layer === 'chips' && defaults['US-chips']) || defaults.US || 'spx';
  if (m === 'CN' && symbol?.startsWith('688')) return defaults['CN-STAR'] || defaults.CN || 'csi300';
  if (m === 'UK' || m === 'CH' || m === 'NORDIC') return defaults.EU || 'stoxx50';
  return defaults[m] || defaults.OTHER || 'spx';
}

/** Short display form, e.g. "2330.TW" -> "2330 TT"-like compact label is avoided; keep the yfinance symbol. */
export function displaySymbol(symbol: string): string {
  return symbol.replace(/^\^/, '');
}

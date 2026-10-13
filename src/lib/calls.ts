// Sell-side calls (owner only): a broker report's rating and target checked against daily closes.
import type { Company, PriceSeries, ReportMeta, SiteData } from './types.ts';
import { daysBetween, indexOnOrBefore, splitFactorSince } from './finance.ts';

const HORIZON_DAYS = 365; // broker targets are usually 12-month targets

export interface CallOutcome {
  ccy?: string;
  then?: number; // price in the report, split-adjusted
  target?: number; // split-adjusted
  last?: number;
  lastDate?: string;
  since?: number; // share price change since the report
  toGo?: number; // remaining move to the target, in the target's direction
  reachedOn?: string;
  daysLeft?: number;
  status: 'reached' | 'open' | 'expired' | 'no-price';
}

export interface CallRow extends CallOutcome {
  report: ReportMeta;
  company?: Company;
  symbol?: string;
}

/** The listing quoted in the target's currency (a KRW target needs the Seoul listing, not an ADR). */
export function callSymbol(r: ReportMeta, site: SiteData): string | undefined {
  const c = site.companies[r.companies?.[0] ?? ''];
  if (!c || c.listing !== 'listed') return undefined;
  const ccy = r.targetPrice?.currency?.toUpperCase();
  if (!ccy) return c.symbol;
  return c.tickers.find((t) => t.currency?.toUpperCase() === ccy)?.symbol;
}

export function callOutcome(r: ReportMeta, s: PriceSeries | undefined, today: string): CallOutcome {
  const ccy = r.targetPrice?.currency;
  if (!s?.c.length || !r.targetPrice?.value) return { ccy, status: 'no-price' };
  const date = (r.priceAtReport?.date ?? r.date).slice(0, 10);
  const f = splitFactorSince(s.splits, date);
  const i0 = indexOnOrBefore(s.d, date);
  const then = r.priceAtReport?.value ? r.priceAtReport.value / f : i0 >= 0 ? s.c[i0] : undefined;
  const target = r.targetPrice.value / f;
  const last = s.c[s.c.length - 1];
  const lastDate = s.d[s.d.length - 1];
  const dir = then === undefined || target >= then ? 1 : -1; // a target below the price is a call for a fall
  const end = new Date(Date.parse(date) + HORIZON_DAYS * 86400000).toISOString().slice(0, 10);
  let reachedOn: string | undefined;
  for (let i = Math.max(0, i0 + 1); i < s.d.length && s.d[i] <= end; i++) {
    if (s.d[i] > date && dir * s.c[i] >= dir * target) {
      reachedOn = s.d[i];
      break;
    }
  }
  const elapsed = daysBetween(date, today);
  return {
    ccy,
    then,
    target,
    last,
    lastDate,
    since: then ? last / then - 1 : undefined,
    toGo: dir * (target / last - 1),
    reachedOn,
    daysLeft: Math.max(0, HORIZON_DAYS - elapsed),
    status: reachedOn ? 'reached' : elapsed > HORIZON_DAYS ? 'expired' : 'open',
  };
}

export interface BrokerStats {
  broker: string;
  calls: number;
  reached: number;
  hitRate?: number; // reached / (reached + expired)
  medianSince?: number;
}

export function brokerSummary(rows: CallRow[]): BrokerStats[] {
  const by = new Map<string, CallRow[]>();
  for (const r of rows) {
    const b = r.report.broker ?? 'Unknown';
    by.set(b, [...(by.get(b) ?? []), r]);
  }
  return [...by]
    .map(([broker, list]) => {
      const reached = list.filter((x) => x.status === 'reached').length;
      const decided = reached + list.filter((x) => x.status === 'expired').length;
      const since = list.map((x) => x.since).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
      const m = since.length >> 1;
      return {
        broker,
        calls: list.length,
        reached,
        hitRate: decided ? reached / decided : undefined,
        medianSince: since.length ? (since.length % 2 ? since[m] : (since[m - 1] + since[m]) / 2) : undefined,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.broker.localeCompare(b.broker));
}

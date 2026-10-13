// Earnings calendar and results, combined from the quotes (next report date for every listed company)
// and generated/earnings.json (consensus and results for names reporting around now). Pure functions.
import type { Company, EarningsFile, EarningsNext, EarningsReport, Quote, SiteData, Tier } from './types.ts';
import { daysBetween } from './finance.ts';
import { marketOf } from './symbols.ts';

export interface UpcomingReport {
  company: Company;
  symbol: string;
  date: string;
  next?: EarningsNext;
  estimated?: boolean;
  ccy?: string;
}

export interface RecentReport {
  company: Company;
  symbol: string;
  report: EarningsReport;
  ccy?: string;
}

const TIER_RANK: Record<Tier, number> = { core: 0, focus: 1, watch: 2 };

function byWeight(quotes: Record<string, Quote>) {
  return (a: { company: Company; symbol: string }, b: { company: Company; symbol: string }) =>
    TIER_RANK[a.company.tier] - TIER_RANK[b.company.tier] || (quotes[b.symbol]?.mcapUsd ?? 0) - (quotes[a.symbol]?.mcapUsd ?? 0);
}

/** Reports due between `from` and `to` (inclusive), soonest first, larger and core names first within a day. */
export function upcomingReports(site: SiteData, quotes: Record<string, Quote>, earnings: EarningsFile, from: string, to: string): UpcomingReport[] {
  const out: UpcomingReport[] = [];
  for (const c of Object.values(site.companies)) {
    if (c.listing !== 'listed' || !c.symbol) continue;
    const q = quotes[c.symbol];
    const rec = earnings[c.symbol];
    // The calendar entry from the earnings feed is more precise than the quote's date, when it is current.
    const next = rec?.next && rec.next.date >= from ? rec.next : undefined;
    const date = next?.date ?? q?.earn;
    if (!date || date < from || date > to) continue;
    out.push({ company: c, symbol: c.symbol, date, next, estimated: next ? next.estimated : q?.earnEst, ccy: rec?.ccy });
  }
  const weight = byWeight(quotes);
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : weight(a, b)));
}

/** Results published between `from` and `to` (inclusive), newest first. */
export function recentReports(site: SiteData, quotes: Record<string, Quote>, earnings: EarningsFile, from: string, to: string): RecentReport[] {
  const out: RecentReport[] = [];
  for (const c of Object.values(site.companies)) {
    if (c.listing !== 'listed' || !c.symbol) continue;
    const rec = earnings[c.symbol];
    const report = rec?.history.find((h) => h.date >= from && h.date <= to && (h.epsActual !== undefined || h.revActual !== undefined));
    if (report) out.push({ company: c, symbol: c.symbol, report, ccy: rec.ccy });
  }
  const weight = byWeight(quotes);
  return out.sort((a, b) => (a.report.date < b.report.date ? 1 : a.report.date > b.report.date ? -1 : weight(a, b)));
}

/** "before the open" / "after the close": only meaningful for US listings, whose times Yahoo reports in New York time. */
export function reportTimeLabel(symbol: string, time: EarningsNext['time']): string | undefined {
  if (!time || marketOf(symbol) !== 'US') return undefined;
  return time === 'bmo' ? 'before the open' : 'after the close';
}

export interface EarningsFlag {
  kind: 'upcoming' | 'reported';
  date: string;
  days: number; // until the report (upcoming) or since it (reported)
  report?: EarningsReport;
}

/** A report that matters for a view now: results in the last `pastDays`, or a report due within `aheadDays`. */
export function earningsFlag(
  symbol: string | undefined,
  quote: Quote | undefined,
  earnings: EarningsFile,
  today: string,
  pastDays = 7,
  aheadDays = 14,
): EarningsFlag | undefined {
  if (!symbol) return undefined;
  const rec = earnings[symbol];
  const last = rec?.history[0];
  if (last && last.date <= today && daysBetween(last.date, today) <= pastDays && (last.epsActual !== undefined || last.revActual !== undefined)) {
    return { kind: 'reported', date: last.date, days: daysBetween(last.date, today), report: last };
  }
  const date = rec?.next && rec.next.date >= today ? rec.next.date : quote?.earn;
  if (date && date >= today && daysBetween(today, date) <= aheadDays) return { kind: 'upcoming', date, days: daysBetween(today, date) };
  return undefined;
}

/** EPS figures as reported (per share, reporting currency): two decimals, or three below 0.1. */
export function fmtEps(x: number | undefined): string {
  if (x === undefined || !Number.isFinite(x)) return '—';
  const digits = Math.abs(x) < 0.1 && x !== 0 ? 3 : 2;
  return x.toFixed(digits).replace('-', '−');
}

import type { PriceSeries, Quote, Returns, ThesisRecord, ThesisStatus } from './types.ts';

export const AI_BASE_DATE = '2022-12-30'; // last close before the 2023 AI rally; ChatGPT launched 2022-11-30

export interface Fundamentals {
  marketCap?: number;
  currency?: string;
  trailingPE?: number;
  forwardPE?: number;
  priceToSales?: number;
  evToEbitda?: number;
  targetMean?: number;
  targetHigh?: number;
  targetLow?: number;
  analysts?: number;
  recommendation?: string;
  nextEarnings?: string;
  earningsEstimated?: boolean;
  high52?: number;
  low52?: number;
  asOf?: string;
}

/** Parse a data/prices CSV (date,close,high,low). Rows with a missing close are skipped. */
export function parsePriceCsv(symbol: string, text: string): PriceSeries {
  const d: string[] = [];
  const c: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [date, close, high, low] = line.split(',');
    const cv = Number(close);
    if (!date || !close || !Number.isFinite(cv) || cv <= 0) continue;
    const hv = Number(high);
    const lv = Number(low);
    d.push(date);
    c.push(cv);
    h.push(Number.isFinite(hv) && hv > 0 ? hv : cv);
    l.push(Number.isFinite(lv) && lv > 0 ? lv : cv);
  }
  return { s: symbol, d, c, h, l };
}

function retOver(c: number[], sessions: number): number | undefined {
  const n = c.length;
  if (n <= sessions) return undefined;
  const past = c[n - 1 - sessions];
  return past > 0 ? c[n - 1] / past - 1 : undefined;
}

/** Index of the last observation on or before `date` (ISO yyyy-mm-dd), or -1. */
export function indexOnOrBefore(d: string[], date: string): number {
  let lo = 0;
  let hi = d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function valueOnOrBefore(series: PriceSeries, date: string): { date: string; close: number } | undefined {
  const i = indexOnOrBefore(series.d, date);
  return i >= 0 ? { date: series.d[i], close: series.c[i] } : undefined;
}

export function computeReturns(series: PriceSeries): Returns {
  const { d, c } = series;
  const n = c.length;
  if (!n) return {};
  const last = c[n - 1];
  const lastDate = d[n - 1];
  const r: Returns = {
    d1: retOver(c, 1),
    w1: retOver(c, 5),
    m1: retOver(c, 21),
    m3: retOver(c, 63),
    y1: retOver(c, 252),
  };
  const yearStart = `${lastDate.slice(0, 4)}-01-01`;
  const iy = indexOnOrBefore(d, yearStart) ;
  // ytd: last close of the previous calendar year (strictly before Jan 1)
  const iPrevYear = iy >= 0 && d[iy] === yearStart ? iy - 1 : iy;
  if (iPrevYear >= 0) r.ytd = last / c[iPrevYear] - 1;
  const ia = indexOnOrBefore(d, AI_BASE_DATE);
  if (ia >= 0) r.ai = last / c[ia] - 1;
  return r;
}

export function computeQuote(
  series: PriceSeries,
  fundamentals: Fundamentals | undefined,
  fx: Record<string, number>,
  fallbackCurrency?: string,
): Quote | undefined {
  const n = series.c.length;
  if (!n) return undefined;
  const window = series.c.slice(Math.max(0, n - 252));
  const ccy = fundamentals?.currency || fallbackCurrency;
  const q: Quote = {
    s: series.s,
    d: series.d[n - 1],
    c: series.c[n - 1],
    ccy,
    r: computeReturns(series),
    hi52: Math.max(...window),
    lo52: Math.min(...window),
  };
  if (fundamentals) {
    if (fundamentals.marketCap) {
      q.mcap = fundamentals.marketCap;
      const rate = ccy ? fx[ccy.toUpperCase()] : undefined;
      if (ccy && ccy.toUpperCase() === 'USD') q.mcapUsd = fundamentals.marketCap;
      else if (rate && rate > 0) q.mcapUsd = fundamentals.marketCap / rate;
    }
    if (fundamentals.trailingPE && fundamentals.trailingPE > 0) q.pe = fundamentals.trailingPE;
    if (fundamentals.forwardPE && fundamentals.forwardPE > 0) q.fpe = fundamentals.forwardPE;
    if (fundamentals.priceToSales && fundamentals.priceToSales > 0) q.ps = fundamentals.priceToSales;
    if (fundamentals.targetMean && fundamentals.targetMean > 0) q.tgt = fundamentals.targetMean;
    if (fundamentals.analysts) q.tgtN = fundamentals.analysts;
    if (fundamentals.recommendation) q.rec = fundamentals.recommendation;
    if (fundamentals.nextEarnings) {
      q.earn = fundamentals.nextEarnings;
      if (fundamentals.earningsEstimated) q.earnEst = true;
    }
  }
  return q;
}

/**
 * Equal-weighted price index of several series, rebased to 100 at `base` (or the first common date after it).
 * Each member contributes its own session-to-session return on the dates it traded, so markets with
 * different holidays can be mixed. Members join the basket on their first available date.
 */
export function basketIndex(seriesList: PriceSeries[], base: string): { d: string[]; v: number[] } {
  const usable = seriesList.filter((s) => s.c.length > 1);
  if (!usable.length) return { d: [], v: [] };
  const returnsByDate = new Map<string, { sum: number; n: number }>();
  for (const s of usable) {
    for (let i = 1; i < s.d.length; i++) {
      const date = s.d[i];
      if (date <= base) continue;
      const r = s.c[i] / s.c[i - 1] - 1;
      if (!Number.isFinite(r) || Math.abs(r) > 0.8) continue; // ignore bad ticks / unadjusted splits
      const cur = returnsByDate.get(date) || { sum: 0, n: 0 };
      cur.sum += r;
      cur.n += 1;
      returnsByDate.set(date, cur);
    }
  }
  const dates = [...returnsByDate.keys()].sort();
  const d = [base];
  const v = [100];
  let level = 100;
  for (const date of dates) {
    const { sum, n } = returnsByDate.get(date)!;
    level *= 1 + sum / n;
    d.push(date);
    v.push(Math.round(level * 100) / 100);
  }
  return { d, v };
}

/** Cumulative split ratio for splits strictly after `date` (e.g. 10 for a 10-for-1 split). */
export function splitFactorSince(splits: [string, number][] | undefined, date: string): number {
  if (!splits?.length) return 1;
  let f = 1;
  for (const [day, ratio] of splits) {
    if (day > date.slice(0, 10) && ratio > 0) f *= ratio;
  }
  return f;
}

export interface ThesisPerformance {
  start?: string; // first trading day used
  base?: number; // split-adjusted base price
  last?: number;
  lastDate?: string;
  ret?: number; // return in the direction of the call (short = profit when price falls)
  marketRet?: number; // raw price change since the start
  benchRet?: number;
  excess?: number; // ret minus benchmark return (direction-adjusted)
  target?: number;
  stop?: number;
  upside?: number; // remaining move to target from the last price, in the direction of the call
  progress?: number; // share of the base->target move achieved (0..1+, may be negative)
  maxFavorable?: number;
  maxAdverse?: number;
  daysElapsed: number;
  daysTotal?: number;
  suggested?: ThesisStatus;
  suggestedOn?: string;
  splitFactor: number;
}

const DAY = 86400000;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
}

export function addMonths(date: string, months: number): string {
  const dt = new Date(date.slice(0, 10) + 'T00:00:00Z');
  const day = dt.getUTCDate();
  dt.setUTCMonth(dt.getUTCMonth() + months);
  if (dt.getUTCDate() !== day) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

/** Performance of a price-tracked thesis. `today` is the evaluation date (defaults to the last price date). */
export function thesisPerformance(
  t: Pick<ThesisRecord, 'createdAt' | 'direction' | 'basePrice' | 'target' | 'stop' | 'horizonMonths' | 'targetDate' | 'status' | 'closed'>,
  series: PriceSeries | undefined,
  bench?: PriceSeries,
  today?: string,
): ThesisPerformance {
  const created = t.createdAt.slice(0, 10);
  const end = t.closed?.date?.slice(0, 10);
  const perf: ThesisPerformance = { daysElapsed: 0, splitFactor: 1 };
  const horizonEnd = t.targetDate || (t.horizonMonths ? addMonths(created, t.horizonMonths) : undefined);
  if (horizonEnd) perf.daysTotal = Math.max(1, daysBetween(created, horizonEnd));
  if (!series || !series.c.length) {
    perf.daysElapsed = Math.max(0, daysBetween(created, today || new Date().toISOString().slice(0, 10)));
    return perf;
  }
  const factor = splitFactorSince(series.splits, created);
  perf.splitFactor = factor;
  const startIdx = indexOnOrBefore(series.d, created);
  const firstIdx = startIdx >= 0 ? startIdx : 0;
  const lastIdx = end ? Math.max(firstIdx, indexOnOrBefore(series.d, end)) : series.c.length - 1;
  const sign = t.direction === 'short' ? -1 : 1;
  const base = t.basePrice?.price ? t.basePrice.price / factor : series.c[firstIdx];
  perf.base = base;
  perf.start = series.d[firstIdx];
  perf.last = series.c[lastIdx];
  perf.lastDate = series.d[lastIdx];
  perf.daysElapsed = Math.max(0, daysBetween(created, perf.lastDate));
  perf.marketRet = perf.last / base - 1;
  perf.ret = sign * perf.marketRet;
  if (t.target?.price) perf.target = t.target.price / factor;
  if (t.stop?.price) perf.stop = t.stop.price / factor;
  if (perf.target) {
    perf.upside = sign * (perf.target / perf.last - 1);
    const span = perf.target - base;
    if (Math.abs(span) > 1e-9) perf.progress = (perf.last - base) / span;
  }
  let maxF = 0;
  let maxA = 0;
  let hitTarget: string | undefined;
  let hitStop: string | undefined;
  for (let i = firstIdx + 1; i <= lastIdx; i++) {
    const close = series.c[i];
    const move = sign * (close / base - 1);
    if (move > maxF) maxF = move;
    if (move < maxA) maxA = move;
    if (series.d[i] <= created) continue;
    if (!hitTarget && perf.target && (sign > 0 ? close >= perf.target : close <= perf.target)) hitTarget = series.d[i];
    if (!hitStop && perf.stop && (sign > 0 ? close <= perf.stop : close >= perf.stop)) hitStop = series.d[i];
  }
  perf.maxFavorable = maxF;
  perf.maxAdverse = maxA;
  if (bench && bench.c.length) {
    const b0 = valueOnOrBefore(bench, perf.start!);
    const b1 = valueOnOrBefore(bench, perf.lastDate!);
    if (b0 && b1 && b0.close > 0) {
      perf.benchRet = b1.close / b0.close - 1;
      perf.excess = perf.ret - sign * perf.benchRet;
    }
  }
  if (t.status === 'active' && (t.direction === 'long' || t.direction === 'short')) {
    if (hitTarget && (!hitStop || hitTarget <= hitStop)) {
      perf.suggested = 'target-hit';
      perf.suggestedOn = hitTarget;
    } else if (hitStop) {
      perf.suggested = 'stopped';
      perf.suggestedOn = hitStop;
    } else if (horizonEnd && (today || perf.lastDate) > horizonEnd) {
      perf.suggested = 'expired';
      perf.suggestedOn = horizonEnd;
    }
  }
  return perf;
}

/** Expected return and payoff ratio from scenarios (probabilities normalized if they do not sum to 1). */
export function scenarioStats(
  scenarios: { price: number; prob?: number }[] | undefined,
  last: number | undefined,
  direction: 'long' | 'short' | string,
): { expected?: number; upside?: number; downside?: number; payoff?: number } {
  if (!scenarios?.length || !last) return {};
  const sign = direction === 'short' ? -1 : 1;
  const withProb = scenarios.filter((s) => s.prob && s.prob > 0);
  const total = withProb.reduce((a, s) => a + (s.prob || 0), 0);
  const moves = scenarios.map((s) => sign * (s.price / last - 1));
  const upside = Math.max(...moves);
  const downside = Math.min(...moves);
  const expected = total > 0 ? withProb.reduce((a, s) => a + ((s.prob || 0) / total) * sign * (s.price / last - 1), 0) : undefined;
  const payoff = downside < 0 ? upside / Math.abs(downside) : undefined;
  return { expected, upside, downside, payoff };
}

import { describe, expect, it } from 'vitest';
import { earningsMove, parseValuationCsv, revenueSurprise, valuationNear } from '../src/lib/finance.ts';
import { earningsFlag, fmtEps, recentReports, reportTimeLabel, upcomingReports } from '../src/lib/earnings.ts';
import type { EarningsFile, PriceSeries, Quote, SiteData } from '../src/lib/types.ts';

const CSV = `date,pe,fpe,ev_ebitda,ps,mcap,tgt,tgt_hi,tgt_lo,analysts,rec
2026-10-13,30.5,22.1,,12,1e12,200,250,150,40,buy
2026-10-14,31,22.5,18,12.2,1e12,205,250,150,41,strong_buy
2026-10-15,-4,22.6,18.1,12.1,1e12,206,251,151,41,strong_buy
`;

describe('valuation history', () => {
  it('parses columns by name and blanks missing or negative multiples', () => {
    const v = parseValuationCsv(CSV);
    expect(v.d).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
    expect(v.ev).toEqual([null, 18, 18.1]);
    expect(v.pe).toEqual([30.5, 31, null]);
    expect(v.rec[1]).toBe('strong_buy');
    expect(v.n[0]).toBe(40);
  });

  it('finds the snapshot nearest a date', () => {
    const v = parseValuationCsv(CSV);
    expect(valuationNear(v, '2026-10-14')).toBe(1);
    expect(valuationNear(v, '2026-10-11')).toBe(0); // the next snapshot, two days later
    expect(valuationNear(v, '2026-09-01')).toBe(-1); // before the history began
    expect(valuationNear(v, '2026-12-01')).toBe(2); // after: the latest one
    expect(valuationNear(undefined, '2026-10-14')).toBe(-1);
  });
});

describe('earnings reaction', () => {
  const s: PriceSeries = { s: 'X', d: ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'], c: [100, 102, 110, 111, 115], h: [], l: [] };

  it('spans the report day and the next session', () => {
    expect(earningsMove(s, '2026-10-09')).toBeCloseTo(0.1); // 100 -> 110
  });
  it('uses the first session after a weekend report', () => {
    expect(earningsMove(s, '2026-10-10')).toBeCloseTo(110 / 102 - 1);
  });
  it('uses the latest close while the second session is pending, and nothing before any session', () => {
    expect(earningsMove(s, '2026-10-14')).toBeCloseTo(115 / 111 - 1);
    expect(earningsMove(s, '2026-10-15')).toBeUndefined();
    expect(earningsMove(s, '2026-10-01')).toBeUndefined();
  });
  it('drops revenue surprises that look like a currency mismatch', () => {
    expect(revenueSurprise({ revEst: 100, revActual: 104 })).toBeCloseTo(0.04);
    expect(revenueSurprise({ revEst: 100, revActual: 3100 })).toBeUndefined();
    expect(revenueSurprise({ revEst: undefined, revActual: 5 })).toBeUndefined();
  });
});

describe('earnings calendar', () => {
  const company = (id: string, symbol: string, tier: 'core' | 'focus' | 'watch') => ({ id, name: id.toUpperCase(), symbol, tier, listing: 'listed', tickers: [{ symbol }] });
  const site = {
    companies: {
      nvda: company('nvda', 'NVDA', 'core'),
      tsmc: company('tsmc', '2330.TW', 'core'),
      small: company('small', 'SMLL', 'watch'),
      priv: { id: 'priv', name: 'Private', listing: 'private', tier: 'core', tickers: [] },
    },
  } as unknown as SiteData;
  const quote = (s: string, earn?: string, mcapUsd = 1e9): Quote => ({ s, d: '2026-10-13', c: 1, r: {}, earn, mcapUsd });
  const quotes: Record<string, Quote> = {
    NVDA: quote('NVDA', '2026-11-19', 4e12),
    '2330.TW': quote('2330.TW', '2026-10-15', 1e12),
    SMLL: quote('SMLL', '2026-10-15', 1e9),
  };
  const earnings: EarningsFile = {
    '2330.TW': {
      updatedAt: '2026-10-13',
      next: { date: '2026-10-16', time: 'bmo', epsEst: 17.5 },
      history: [{ date: '2026-07-17', epsEst: 15, epsActual: 15.4, surprise: 2.7 }],
    },
    SMLL: { updatedAt: '2026-10-13', history: [{ date: '2026-10-09', epsEst: 0.1, epsActual: 0.12, surprise: 20 }] },
  };

  it('lists upcoming reports, preferring the earnings feed date', () => {
    const up = upcomingReports(site, quotes, earnings, '2026-10-13', '2026-10-20');
    expect(up.map((u) => [u.symbol, u.date])).toEqual([
      ['SMLL', '2026-10-15'],
      ['2330.TW', '2026-10-16'],
    ]);
  });

  it('lists recent results, newest first', () => {
    const rec = recentReports(site, quotes, earnings, '2026-10-06', '2026-10-13');
    expect(rec.map((r) => r.symbol)).toEqual(['SMLL']);
  });

  it('flags views around a report', () => {
    expect(earningsFlag('SMLL', quotes.SMLL, earnings, '2026-10-13')?.kind).toBe('reported');
    expect(earningsFlag('2330.TW', quotes['2330.TW'], earnings, '2026-10-13')).toMatchObject({ kind: 'upcoming', date: '2026-10-16', days: 3 });
    expect(earningsFlag('NVDA', quotes.NVDA, earnings, '2026-10-13')).toBeUndefined(); // more than two weeks out
  });

  it('labels report times for US listings only', () => {
    expect(reportTimeLabel('NVDA', 'amc')).toBe('after the close');
    expect(reportTimeLabel('2330.TW', 'bmo')).toBeUndefined();
    expect(fmtEps(-0.054)).toBe('−0.054');
    expect(fmtEps(1.234)).toBe('1.23');
  });
});

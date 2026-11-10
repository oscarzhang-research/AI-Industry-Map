import { describe, expect, it } from 'vitest';
import { alignQuote, earningsMove, epsSurprise, impliedShares, parseValuationCsv, parseValuationSnapshots, rebaseValuation, revenueSurprise, valuationNear } from '../src/lib/finance.ts';
import { earningsFlag, fmtEps, recentReports, reportTimeLabel, upcomingReports, withMarketDates } from '../src/lib/earnings.ts';
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

describe('valuation on the close of each date', () => {
  // One billion shares and forward earnings of 5 a share throughout. The feed's snapshots were taken at
  // other prices than the close on three of the seven days.
  const closes = { d: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'], c: [100, 110, 121, 115, 120, 118, 125] };
  const seenAt = [100, 100, 130, 115, 120, 112, 125]; // the price the feed used: stale on day 2, live on days 3 and 6
  const csv = ['date,pe,fpe,ev_ebitda,ps,mcap,tgt,tgt_hi,tgt_lo,analysts,rec', ...closes.d.map((d, i) => `${d},${seenAt[i] / 4},${seenAt[i] / 5},,${seenAt[i] / 10},${seenAt[i] * 1e9},150,180,120,40,buy`)].join('\n');

  it('recovers the share count and rescales each multiple', () => {
    const snap = parseValuationSnapshots(csv);
    expect(snap.mcap[2]).toBe(130e9);
    expect(impliedShares(snap, closes).every((x) => x === 1e9)).toBe(true);
    const v = rebaseValuation(snap, closes);
    expect(v.fpe).toEqual(closes.c.map((c) => c / 5)); // 20, 22, 24.2, 23, 24, 23.6, 25
    expect(v.pe).toEqual(closes.c.map((c) => c / 4));
    expect(v.ps).toEqual(closes.c.map((c) => c / 10));
    expect(v.tgt).toEqual(closes.c.map(() => 150)); // analyst targets do not depend on the price
    expect('mcap' in v).toBe(false);
  });

  it('leaves short histories and wildly different snapshots alone', () => {
    const short = parseValuationSnapshots(csv.split('\n').slice(0, 4).join('\n'));
    expect(rebaseValuation(short, closes).fpe).toEqual([20, 20, 26]);
    const odd = parseValuationSnapshots(csv.replace(`${130 * 1e9}`, `${300 * 1e9}`)); // a market value that fits no close
    expect(rebaseValuation(odd, closes).fpe[2]).toBe(26);
  });

  it('aligns a quote taken at a live price with its close', () => {
    const q = alignQuote({ s: 'X', d: '2026-11-10', c: 125, r: {}, hi52: 130, lo52: 90, mcap: 130e9, mcapUsd: 130e9, fpe: 26, pe: 32.5 } as never, 1e9);
    expect([q.mcap, q.mcapUsd, q.fpe, q.pe]).toEqual([125e9, 125e9, 25, 31.25]);
    const same = { s: 'X', d: '2026-11-10', c: 125, r: {}, hi52: 130, lo52: 90, mcap: 400e9, fpe: 26 } as never;
    expect(alignQuote(same, 1e9)).toBe(same); // off by more than a quarter: not the same share count, left alone
    expect(alignQuote(same, null)).toBe(same);
  });
});

describe('curated earnings events', () => {
  const companies = { nvidia: { symbol: 'NVDA' }, meta: { symbol: 'META' }, samsung: { symbol: '005930.KS' }, micron: { symbol: 'MU' } };
  const quotes = { NVDA: { earn: '2026-11-17' }, MU: { earn: '2026-12-23', earnEst: true } } as never;
  const earnings = {
    META: { updatedAt: '2026-11-10', history: [{ date: '2026-10-21', epsActual: 3.83 }, { date: '2026-07-29', epsActual: 6.18 }] },
    '005930.KS': { updatedAt: '2026-11-10', history: [{ date: '2026-10-28', epsActual: 9500 }] },
  } as never;
  const ev = (id: string, company: string, start: string, tentative?: boolean) => ({ id, name: id, start, kind: 'earnings', companies: [company], ...(tentative ? { tentative } : {}) });

  it('take the date market data has, and stop being tentative once it is confirmed or past', () => {
    const out = withMarketDates(
      [ev('nvda', 'nvidia', '2026-11-18', true), ev('meta', 'meta', '2026-10-28', true), ev('mu', 'micron', '2026-12-22', true), { id: 'sc26', name: 'SC26', start: '2026-11-15', kind: 'conference', tentative: true }],
      companies,
      quotes,
      earnings,
    );
    expect(out.map((e) => [e.id, e.start, !!e.tentative])).toEqual([
      ['nvda', '2026-11-17', false],
      ['meta', '2026-10-21', false],
      ['mu', '2026-12-23', true], // the feed's date is itself an estimate
      ['sc26', '2026-11-15', true],
    ]);
  });

  it('keep a confirmed date against a one-day difference, and any date with nothing near it', () => {
    const out = withMarketDates([ev('samsung', 'samsung', '2026-10-29'), ev('old', 'meta', '2026-03-01', true)], companies, quotes, earnings);
    expect(out.map((e) => [e.start, !!e.tentative])).toEqual([['2026-10-29', false], ['2026-03-01', true]]);
  });
});

describe('EPS surprise', () => {
  it('is the gap to the estimate in percent', () => {
    expect(epsSurprise({ epsEst: 2.09, epsActual: 2.22 })).toBeCloseTo(6.22, 2);
    expect(epsSurprise({ epsEst: -0.26, epsActual: -0.22 })).toBeCloseTo(15.38, 2); // a smaller loss than expected
    expect(epsSurprise({ epsEst: 0.9, epsActual: 0.25 })).toBeCloseTo(-72.22, 2);
  });
  it('is blank when the two figures are plainly different measures', () => {
    expect(epsSurprise({ epsEst: 10.18, epsActual: -196.54 })).toBeUndefined(); // opposite signs
    expect(epsSurprise({ epsEst: 0.01, epsActual: 0.5 })).toBeUndefined(); // more than 200%
    expect(epsSurprise({ epsEst: 0, epsActual: 0.5 })).toBeUndefined();
    expect(epsSurprise({ epsActual: 0.5 })).toBeUndefined();
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

import { describe, expect, it } from 'vitest';
import { byQuarter, calendarQuarter, compileKpis, financialsFor, parseTwCsv, shiftMonth, shiftQuarter, type KpiData } from '../scripts/lib/kpis.ts';
import { cleanValuation, mixedCurrency, parseValuationCsv, plausibleMultiple } from '../src/lib/finance.ts';
import type { Company } from '../src/lib/types.ts';

describe('calendar quarters', () => {
  it('assigns a fiscal quarter to the calendar quarter holding its midpoint', () => {
    expect(calendarQuarter('2025-07-01', '2025-09-30')).toBe('2025Q3'); // Microsoft FQ1
    expect(calendarQuarter('2025-07-28', '2025-10-26')).toBe('2025Q3'); // NVIDIA FQ3 ends in late October
    expect(calendarQuarter('2025-05-05', '2025-08-03')).toBe('2025Q2'); // Broadcom FQ3 is mostly May-July
    expect(calendarQuarter('2025-09-01', '2025-11-30')).toBe('2025Q4'); // Oracle FQ2
  });
  it('shifts quarters and months across years', () => {
    expect(shiftQuarter('2026Q1', -1)).toBe('2025Q4');
    expect(shiftQuarter('2025Q3', 4)).toBe('2026Q3');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-11', 14)).toBe('2027-01');
  });
});

describe('SEC quarters', () => {
  it('keeps quarter-length periods and prefers the latest filing', () => {
    const q = byQuarter([
      { start: '2025-07-01', end: '2025-09-30', value: 10, filed: '2025-10-30' },
      { start: '2025-07-01', end: '2025-09-30', value: 11, filed: '2026-10-29' }, // restated a year later
      { start: '2025-01-01', end: '2025-09-30', value: 30, filed: '2025-10-30' }, // nine months: skipped
    ]);
    expect([...q.keys()]).toEqual(['2025Q3']);
    expect(q.get('2025Q3')?.value).toBe(11);
  });
});

describe('Taiwan monthly revenue', () => {
  it('converts NT$ thousand and percent', () => {
    const rows = parseTwCsv('month,revenue,yoy,mom\n2026-09,330000000,31.4,-2.1\n2026-08,336000000,,\n');
    expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-09']);
    expect(rows[1].revenue).toBe(330e9);
    expect(rows[1].yoy).toBeCloseTo(0.314);
    expect(rows[0].yoy).toBeUndefined();
  });
});

describe('compileKpis', () => {
  const co = (id: string, symbol: string): Company => ({ id, name: id.toUpperCase(), tickers: [{ symbol }] }) as unknown as Company;
  const companies = { msft: co('msft', 'MSFT'), amzn: co('amzn', 'AMZN'), tsmc: { ...co('tsmc', 'TSM'), tickers: [{ symbol: 'TSM' }, { symbol: '2330.TW' }] } as Company };
  const quarter = (start: string, end: string, value: number) => ({ start, end, value, filed: end });
  const data: KpiData = {
    updatedAt: '2026-10-13T00:00:00Z',
    sec: new Map([
      ['MSFT', { symbol: 'MSFT', capex: [quarter('2025-04-01', '2025-06-30', 17), quarter('2025-07-01', '2025-09-30', 19)] }],
      ['AMZN', { symbol: 'AMZN', capex: [quarter('2025-04-01', '2025-06-30', 31)] }],
    ]),
    tw: new Map([['2330', parseTwCsv('month,revenue,yoy,mom\n2026-08,330000000,33.8,\n2026-09,331000000,31.4,\n')]]),
  };

  it('sums a measure across companies and marks quarters not everyone has reported', () => {
    const [k] = compileKpis({ indicators: [{ id: 'capex', name: 'Capex', layer: 'infrastructure', kind: 'stack', metric: 'capex', companies: ['msft', 'amzn'], description: 'x' }] }, companies, data);
    expect(k.kind).toBe('stack');
    if (k.kind !== 'stack') return;
    expect(k.periods).toEqual(['2025Q2', '2025Q3']);
    expect(k.total).toEqual([48, 19]);
    expect(k.complete).toEqual([true, false]);
  });

  it('builds monthly and growth tables from Taiwan data, and company financials', () => {
    const out = compileKpis(
      {
        indicators: [
          { id: 'tsmc', name: 'TSMC', layer: 'chips', kind: 'monthly', company: 'tsmc', description: 'x' },
          { id: 'tw', name: 'TW', layer: 'chips', kind: 'growth-table', frequency: 'month', companies: ['tsmc'], description: 'x' },
          { id: 'none', name: 'No data', layer: 'chips', kind: 'stack', metric: 'revenue', companies: ['tsmc'], description: 'x' },
        ],
      },
      companies,
      data,
    );
    expect(out.map((k) => k.id)).toEqual(['tsmc', 'tw']); // indicators without data are left out
    const tw = out[1];
    if (tw.kind !== 'growth-table') throw new Error('kind');
    expect(tw.periods[tw.periods.length - 1]).toBe('2026-09');
    expect(tw.rows[0].values[tw.periods.length - 1]).toBeCloseTo(0.314);
    expect(financialsFor(companies.tsmc, data)?.months?.length).toBe(2);
    expect(financialsFor(companies.msft, data)?.quarters?.map((q) => q.capex)).toEqual([17, 19]);
  });
});

describe('valuation cleaning', () => {
  it('drops implausible multiples, and sales and EV multiples across currencies', () => {
    expect(plausibleMultiple('fpe', 4712)).toBeUndefined();
    expect(plausibleMultiple('pe', 0.01)).toBeUndefined();
    expect(plausibleMultiple('pe', 25)).toBe(25);
    expect(mixedCurrency({ currency: 'USD', financialCurrency: 'TWD' })).toBe(true);
    expect(mixedCurrency({ currency: 'GBp', financialCurrency: 'GBP' })).toBe(false);
    const v = cleanValuation(parseValuationCsv('date,pe,fpe,ev_ebitda,ps\n2026-10-13,32,20,5.1,0.52\n'), true);
    expect([v.pe[0], v.fpe[0], v.ev[0], v.ps[0]]).toEqual([32, 20, null, null]);
  });
});

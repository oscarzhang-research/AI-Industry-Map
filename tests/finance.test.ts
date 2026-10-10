import { describe, expect, it } from 'vitest';
import { addMonths, basketIndex, capWeightIndex, computeReturns, parsePriceCsv, scenarioStats, splitFactorSince, thesisPerformance } from '../src/lib/finance.ts';
import type { PriceSeries, ThesisRecord } from '../src/lib/types.ts';

function series(points: [string, number][], splits?: [string, number][]): PriceSeries {
  return { s: 'TEST', d: points.map((p) => p[0]), c: points.map((p) => p[1]), h: points.map((p) => p[1]), l: points.map((p) => p[1]), splits };
}

const base: Pick<ThesisRecord, 'createdAt' | 'direction' | 'basePrice' | 'target' | 'stop' | 'horizonMonths' | 'targetDate' | 'status' | 'closed'> = {
  createdAt: '2026-01-05T14:00:00.000Z',
  direction: 'long',
  status: 'active',
};

describe('parsePriceCsv', () => {
  it('reads rows and skips missing or non-positive closes', () => {
    const s = parsePriceCsv('X', 'date,close,high,low\n2026-01-02,10,11,9\n2026-01-05,,1,1\n2026-01-06,0,1,1\n2026-01-07,12,,\n');
    expect(s.d).toEqual(['2026-01-02', '2026-01-07']);
    expect(s.c).toEqual([10, 12]);
    expect(s.h).toEqual([11, 12]); // a missing high falls back to the close
  });
});

describe('computeReturns', () => {
  it('measures YTD from the last close of the previous year', () => {
    const s = series([
      ['2022-12-30', 50],
      ['2025-12-30', 90],
      ['2025-12-31', 100],
      ['2026-01-02', 105],
      ['2026-01-05', 110],
    ]);
    const r = computeReturns(s);
    expect(r.ytd).toBeCloseTo(0.1);
    expect(r.d1).toBeCloseTo(110 / 105 - 1);
    expect(r.ai).toBeCloseTo(110 / 50 - 1);
  });
});

describe('basketIndex', () => {
  it('averages daily returns and ignores implausible jumps', () => {
    const a = series([
      ['2026-01-01', 100],
      ['2026-01-02', 110],
      ['2026-01-05', 110],
    ]);
    const b = series([
      ['2026-01-01', 50],
      ['2026-01-02', 50],
      ['2026-01-05', 500], // +900%: a bad tick, skipped
    ]);
    const idx = basketIndex([a, b], '2026-01-01');
    expect(idx.d).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    expect(idx.v[1]).toBeCloseTo(105);
    expect(idx.v[2]).toBeCloseTo(105);
  });
});

describe('capWeightIndex', () => {
  it('tracks the combined market value when membership is fixed', () => {
    const a = series([
      ['2026-01-01', 10],
      ['2026-01-02', 11],
      ['2026-01-05', 12.1],
    ]);
    const b = series([
      ['2026-01-01', 20],
      ['2026-01-02', 18],
      ['2026-01-05', 18],
    ]);
    // Today: A is worth 121 (10 units at 12.1), B 180 (10 units at 18). At the base both held 10 units: 100 + 200.
    const idx = capWeightIndex([{ series: a, mcap: 121 }, { series: b, mcap: 180 }], '2026-01-01');
    expect(idx.v[1]).toBeCloseTo((110 + 180) / 3, 1);
    expect(idx.v[2]).toBeCloseTo((121 + 180) / 3, 1);
    expect(idx.top[0]).toEqual({ s: 'TEST', w: 0.598 });
  });

  it('adds a newly listed company without moving the level', () => {
    const a = series([
      ['2026-01-01', 10],
      ['2026-01-02', 10],
      ['2026-01-05', 11],
    ]);
    const ipo = series([
      ['2026-01-02', 50],
      ['2026-01-05', 50],
    ]);
    const idx = capWeightIndex([{ series: a, mcap: 110 }, { series: ipo, mcap: 10000 }], '2026-01-01');
    expect(idx.v[1]).toBeCloseTo(100); // the IPO day only sets its starting price
    // Next day: A +10% with weight 100, the IPO flat with weight 10000.
    expect(idx.v[2]).toBeCloseTo(100 * (1 + (100 * 0.1) / (100 + 10000)), 2);
  });

  it('counts a member that does not trade on a day as unchanged', () => {
    const us = series([
      ['2026-01-01', 10],
      ['2026-01-02', 11],
    ]);
    const asia = series([
      ['2026-01-01', 10],
      ['2026-01-05', 10],
    ]);
    const idx = capWeightIndex([{ series: us, mcap: 110 }, { series: asia, mcap: 100 }], '2026-01-01');
    expect(idx.d).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    expect(idx.v[1]).toBeCloseTo(105); // +10% on half the weight
  });
});

describe('splits', () => {
  it('multiplies ratios of splits after the date', () => {
    expect(splitFactorSince([['2024-06-10', 10]], '2024-01-01')).toBe(10);
    expect(splitFactorSince([['2024-06-10', 10]], '2024-06-10')).toBe(1);
    expect(splitFactorSince(undefined, '2024-01-01')).toBe(1);
  });
});

describe('thesisPerformance', () => {
  const s = series([
    ['2026-01-02', 100],
    ['2026-01-05', 100],
    ['2026-01-06', 104],
    ['2026-01-07', 121],
    ['2026-01-08', 115],
  ]);

  it('scores a long from the base price and suggests target hit on the first close above it', () => {
    const p = thesisPerformance({ ...base, basePrice: { price: 100 }, target: { price: 120 }, stop: { price: 90 } }, s);
    expect(p.ret).toBeCloseTo(0.15);
    expect(p.progress).toBeCloseTo(0.75);
    expect(p.maxFavorable).toBeCloseTo(0.21);
    expect(p.suggested).toBe('target-hit');
    expect(p.suggestedOn).toBe('2026-01-07');
  });

  it('signs a short so a falling price is a gain', () => {
    const down = series([
      ['2026-01-05', 100],
      ['2026-01-06', 80],
    ]);
    const p = thesisPerformance({ ...base, direction: 'short', basePrice: { price: 100 }, stop: { price: 110 } }, down);
    expect(p.ret).toBeCloseTo(0.2);
    expect(p.marketRet).toBeCloseTo(-0.2);
    expect(p.suggested).toBeUndefined();
  });

  it('subtracts the benchmark for excess return', () => {
    const bench = series([
      ['2026-01-05', 1000],
      ['2026-01-08', 1050],
    ]);
    const p = thesisPerformance({ ...base, basePrice: { price: 100 } }, s, bench);
    expect(p.benchRet).toBeCloseTo(0.05);
    expect(p.excess).toBeCloseTo(0.1);
  });

  it('adjusts a base price written before a split', () => {
    // A 10-for-1 split after the view opened: the series is already split-adjusted.
    const adj = series(
      [
        ['2026-01-05', 10],
        ['2026-03-02', 12],
      ],
      [['2026-02-01', 10]],
    );
    const p = thesisPerformance({ ...base, basePrice: { price: 100 }, target: { price: 150 } }, adj);
    expect(p.splitFactor).toBe(10);
    expect(p.base).toBeCloseTo(10);
    expect(p.target).toBeCloseTo(15);
    expect(p.ret).toBeCloseTo(0.2);
  });

  it('suggests expiry once the horizon has passed', () => {
    const p = thesisPerformance({ ...base, basePrice: { price: 100 }, horizonMonths: 1 }, s, undefined, '2026-03-01');
    expect(p.suggested).toBe('expired');
    expect(p.suggestedOn).toBe(addMonths('2026-01-05', 1));
  });

  it('never suggests a status for closed views', () => {
    const p = thesisPerformance({ ...base, status: 'closed', basePrice: { price: 100 }, target: { price: 101 } }, s);
    expect(p.suggested).toBeUndefined();
  });
});

describe('scenarioStats', () => {
  it('weights scenario returns by probability', () => {
    const st = scenarioStats(
      [
        { price: 150, prob: 0.25 },
        { price: 120, prob: 0.5 },
        { price: 80, prob: 0.25 },
      ],
      100,
      'long',
    );
    expect(st.expected).toBeCloseTo(0.25 * 0.5 + 0.5 * 0.2 + 0.25 * -0.2);
    expect(st.payoff).toBeCloseTo(0.5 / 0.2);
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-20', 12)).toBe('2027-08-20');
  });
});

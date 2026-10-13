import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brokerSummary, callOutcome, callSymbol } from '../src/lib/calls.ts';
import { withTokenExpiry } from '../src/lib/tokenExpiry.ts';
import { weekOf } from '../scripts/fact-pack.ts';
import { report, tokenAlerts } from '../scripts/alerts.ts';
import type { PriceSeries, ReportMeta, SiteData } from '../src/lib/types.ts';

describe('fact pack week', () => {
  it('uses Monday to Friday, and the week just ended on weekends', () => {
    expect(weekOf('2026-10-13')).toEqual({ start: '2026-10-12', end: '2026-10-16' }); // Tuesday
    expect(weekOf('2026-10-17')).toEqual({ start: '2026-10-12', end: '2026-10-16' }); // Saturday
    expect(weekOf('2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-16' }); // Sunday
    expect(weekOf('2026-10-16')).toEqual({ start: '2026-10-12', end: '2026-10-16' }); // Friday
  });
});

describe('sell-side calls', () => {
  const site = {
    companies: {
      hynix: { id: 'hynix', name: 'SK hynix', listing: 'listed', symbol: '000660.KS', tickers: [{ symbol: '000660.KS', currency: 'KRW' }, { symbol: 'HXSCL', currency: 'USD' }] },
    },
  } as unknown as SiteData;
  const call = (over: Partial<ReportMeta> = {}): ReportMeta =>
    ({
      id: 'r1',
      kind: 'sell-side',
      visibility: 'private',
      format: 'pdf',
      file: 'report.pdf',
      title: 't',
      date: '2026-01-05',
      companies: ['hynix'],
      nodes: [],
      tags: [],
      broker: 'HSBC',
      rating: 'Buy',
      targetPrice: { value: 150, currency: 'KRW' },
      priceAtReport: { value: 100, currency: 'KRW', date: '2026-01-02' },
      ...over,
    }) as ReportMeta;
  const s: PriceSeries = { s: '000660.KS', d: ['2026-01-02', '2026-03-02', '2026-06-01', '2026-09-01'], c: [100, 120, 155, 140], h: [], l: [] };

  it('picks the listing quoted in the target currency', () => {
    expect(callSymbol(call(), site)).toBe('000660.KS');
    expect(callSymbol(call({ targetPrice: { value: 10, currency: 'USD' } }), site)).toBe('HXSCL');
    expect(callSymbol(call({ targetPrice: { value: 10, currency: 'EUR' } }), site)).toBeUndefined();
  });

  it('finds the first close at the target within twelve months', () => {
    const o = callOutcome(call(), s, '2026-10-01');
    expect(o.reachedOn).toBe('2026-06-01');
    expect(o.status).toBe('reached');
    expect(o.since).toBeCloseTo(0.4);
  });

  it('adjusts for later splits and expires after a year', () => {
    const split: PriceSeries = { ...s, c: [50, 60, 70, 72], splits: [['2026-02-01', 2]] };
    const o = callOutcome(call(), split, '2027-02-01');
    expect(o.then).toBe(50);
    expect(o.target).toBe(75);
    expect(o.status).toBe('expired');
    const stats = brokerSummary([{ report: call(), ...o }]);
    expect(stats[0]).toMatchObject({ broker: 'HSBC', calls: 1, reached: 0, hitRate: 0 });
  });
});

describe('token reminder', () => {
  it('adds or replaces tokenExpires in vault/settings.yaml', () => {
    expect(withTokenExpiry(undefined, '2027-10-10')).toContain('tokenExpires: 2027-10-10');
    expect(withTokenExpiry('# keep\ntokenExpires: 2026-01-01\nother: 1\n', '2027-10-10')).toBe('# keep\ntokenExpires: 2027-10-10\nother: 1\n');
  });

  it('alerts two weeks ahead and after expiry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vault-'));
    mkdirSync(join(dir, 'vault'));
    writeFileSync(join(dir, 'vault', 'settings.yaml'), 'tokenExpires: 2026-10-20\n');
    expect(tokenAlerts(dir, '2026-10-01')).toEqual([]);
    expect(tokenAlerts(dir, '2026-10-10')[0].detail).toContain('in 10 days');
    expect(tokenAlerts(dir, '2026-10-21')[0].detail).toContain('Expired');
  });

  it('signs the report by its alerts only', () => {
    const a = [{ kind: 'review-due' as const, key: 'review:x', view: 'x', title: 'X', detail: 'd' }];
    const sig = (md: string) => /signature: (\w+)/.exec(md)?.[1];
    expect(sig(report(a, '2026-10-13', 'https://s/'))).toBe(sig(report(a, '2026-10-14', 'https://s/')));
    expect(sig(report([], '2026-10-13', 'https://s/'))).not.toBe(sig(report(a, '2026-10-13', 'https://s/')));
  });
});

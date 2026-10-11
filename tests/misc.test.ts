import { describe, expect, it } from 'vitest';
import { benchmarkIdFor, marketOf, safeSymbol } from '../src/lib/symbols.ts';
import { htmlToText, injectReaderShim, withReaderLang } from '../src/lib/reportShim.ts';
import { periodFor, prune, uniqueId } from '../src/editor/util.ts';
import { fmtPct, fmtPrice } from '../src/lib/format.ts';
import { setSiteFlag } from '../src/lib/configEdit.ts';
import type { AnyRecord } from '../src/lib/types.ts';

const defaults = { US: 'ndx', 'US-chips': 'sox', KR: 'kospi', CN: 'csi300', 'CN-STAR': 'star50', EU: 'stoxx50', OTHER: 'spx' };

describe('symbols', () => {
  it('makes file-safe names the same way as the Python fetcher', () => {
    expect(safeSymbol('^GSPC')).toBe('_GSPC');
    expect(safeSymbol('000660.KS')).toBe('000660.KS');
    expect(safeSymbol('BRK-B')).toBe('BRK-B');
    expect(safeSymbol('KRW=X')).toBe('KRW_X');
  });

  it('maps suffixes to markets', () => {
    expect(marketOf('NVDA')).toBe('US');
    expect(marketOf('2330.TW')).toBe('TW');
    expect(marketOf('3324.TWO')).toBe('TW');
    expect(marketOf('000660.KS')).toBe('KR');
    expect(marketOf('688795.SS')).toBe('CN');
    expect(marketOf('^NDX')).toBe('OTHER');
  });

  it('picks benchmarks by market and layer', () => {
    expect(benchmarkIdFor('NVDA', 'chips', defaults)).toBe('sox');
    expect(benchmarkIdFor('MSFT', 'infrastructure', defaults)).toBe('ndx');
    expect(benchmarkIdFor('688795.SS', 'chips', defaults)).toBe('star50');
    expect(benchmarkIdFor('ASML.AS', 'chips', defaults)).toBe('stoxx50');
    expect(benchmarkIdFor(undefined, 'chips', defaults)).toBe('sox'); // baskets
    expect(benchmarkIdFor('basket:energy', 'energy', defaults)).toBe('ndx');
  });
});

describe('report shim', () => {
  it('goes first in <head>, once', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>';
    const out = injectReaderShim(html);
    expect(out.indexOf('data-aim-shim')).toBeLessThan(out.indexOf('<title>'));
    expect(injectReaderShim(out)).toBe(out);
    expect(withReaderLang(out, 'zh')).toContain('<script data-aim-shim data-lang="zh">');
  });

  it('extracts searchable text without scripts or styles', () => {
    expect(htmlToText('<style>a{}</style><p>Memory &amp; HBM</p><script>var x=1</script>')).toBe('Memory & HBM');
  });
});

describe('editor helpers', () => {
  it('prunes empty values but keeps zero and false', () => {
    expect(prune({ a: '', b: [], c: {}, d: 0, e: false, f: { g: undefined }, h: [{ i: '' }], j: 'x  ' })).toEqual({ d: 0, e: false, j: 'x' });
  });

  it('numbers duplicate ids', () => {
    const recs = [{ id: 'a' }, { id: 'a-2' }] as AnyRecord[];
    expect(uniqueId('a', recs)).toBe('a-3');
    expect(uniqueId('b', recs)).toBe('b');
  });

  it('computes journal periods', () => {
    expect(periodFor('week', '2026-10-08')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(periodFor('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodFor('quarter', '2026-11-03')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
});

describe('format', () => {
  it('formats prices and changes', () => {
    expect(fmtPrice(229.28, 'USD')).toBe('$229.28');
    expect(fmtPrice(1691000, 'KRW')).toBe('₩1,691,000');
    expect(fmtPrice(0)).toBe('0');
    expect(fmtPct(-0.0123)).toBe('−1.2%');
    expect(fmtPct(12.5)).toBe('+1,250%');
    expect(fmtPct(undefined)).toBe('—');
  });
});

describe('site config switches', () => {
  const yaml = [
    '# Site-wide settings.',
    'site:',
    '  name: AI Industry Map',
    '  showExamples: true            # placeholder records',
    '  disclaimer: >-',
    '    Not advice.',
    '',
    'defaults:',
    '  showExamples: true',
    '',
  ].join('\n');

  it('flips the flag in the site block and keeps its comment', () => {
    const out = setSiteFlag(yaml, 'showExamples', false);
    expect(out).toContain('  showExamples: false            # placeholder records');
    expect(out.split('\n')[8]).toBe('  showExamples: true'); // other sections untouched
    expect(setSiteFlag(out, 'showExamples', true)).toBe(yaml);
  });

  it('adds the flag when the site block lacks it', () => {
    const out = setSiteFlag(yaml, 'experimental', false);
    expect(out.split('\n')[2]).toBe('  experimental: false');
  });
});

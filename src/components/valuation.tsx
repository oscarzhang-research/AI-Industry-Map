// Valuation over time (company page) and the valuation when a view opened against today's (view page).
// Both read the daily snapshots in PriceSeries.val (data/valuation/<symbol>.csv).
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { PriceSeries, Quote, ValuationSeries } from '../lib/types.ts';
import { EChart, chartTheme, tooltipBase } from './EChart.tsx';
import { Change, Segmented } from './ui.tsx';
import { useThemeVersion } from '../lib/hooks.ts';
import { indexOnOrBefore, splitFactorSince, valuationNear } from '../lib/finance.ts';
import { fmtDate, fmtMultiple, fmtPrice } from '../lib/format.ts';

type Metric = 'fpe' | 'pe' | 'ev' | 'ps' | 'tgt';
const METRIC_LABEL: Record<Metric, string> = { fpe: 'Forward P/E', pe: 'Trailing P/E', ev: 'EV/EBITDA', ps: 'Price/sales', tgt: 'Target vs price' };
const MIN_POINTS = 5;

export const REC_LABEL: Record<string, string> = {
  strong_buy: 'Strong buy',
  buy: 'Buy',
  hold: 'Hold',
  underperform: 'Underperform',
  sell: 'Sell',
  none: '—',
};

const count = (xs: (number | null)[]) => xs.filter((x) => x !== null).length;

/** Company page: forward and trailing multiples and the consensus target, one snapshot per trading day. */
export function ValuationHistory({ series, ccy }: { series: PriceSeries; ccy?: string }) {
  const val = series.val;
  const themeV = useThemeVersion();
  const available = useMemo(
    () => (val ? (['fpe', 'pe', 'ev', 'ps', 'tgt'] as Metric[]).filter((m) => count(val[m]) >= 2) : []),
    [val],
  );
  const [pick, setPick] = useState<Metric>('fpe');
  const metric = available.includes(pick) ? pick : available[0];

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!val || !metric || val.d.length < MIN_POINTS) return null;
    const t = chartTheme();
    const few = val.d.length < 40;
    const base = { type: 'line', showSymbol: few, symbolSize: 5, connectNulls: false };
    let lines: unknown[];
    let yFormat: (v: number) => string;
    if (metric === 'tgt') {
      // Targets are as published; divide earlier ones by later splits so they match the adjusted closes.
      const adj = (xs: (number | null)[]) => xs.map((x, i) => (x === null ? null : x / splitFactorSince(series.splits, val.d[i])));
      const i0 = Math.max(0, indexOnOrBefore(series.d, val.d[0]));
      const price = series.d.slice(i0).map((d, i) => [d, series.c[i0 + i]]);
      lines = [
        { ...base, name: 'Close', data: price, showSymbol: false, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent } },
        { ...base, name: 'Target (mean)', data: val.d.map((d, i) => [d, adj(val.tgt)[i]]), lineStyle: { width: 2, color: t.ink2 }, itemStyle: { color: t.ink2 } },
        { ...base, name: 'Highest target', data: val.d.map((d, i) => [d, adj(val.hi)[i]]), showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: t.up }, itemStyle: { color: t.up } },
        { ...base, name: 'Lowest target', data: val.d.map((d, i) => [d, adj(val.lo)[i]]), showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: t.down }, itemStyle: { color: t.down } },
      ];
      yFormat = (v) => fmtPrice(v);
    } else {
      lines = [
        { ...base, name: METRIC_LABEL[metric], data: val.d.map((d, i) => [d, val[metric][i]]), lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.05 } },
      ];
      yFormat = (v) => `${v.toFixed(v >= 100 ? 0 : 1)}×`;
    }
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 16, bottom: 26 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        formatter: (ps: { seriesName: string; value: [string, number | null] }[]) => {
          if (!ps.length) return '';
          const rows = ps
            .filter((p) => p.value[1] !== null && p.value[1] !== undefined)
            .map((p) => `<div>${p.seriesName}: <b>${metric === 'tgt' ? fmtPrice(p.value[1]!, ccy) : fmtMultiple(p.value[1]!)}</b></div>`)
            .join('');
          return `<div style="color:${t.muted}">${fmtDate(ps[0].value[0])}</div>${rows}`;
        },
      },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11 }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: yFormat }, splitLine: { lineStyle: { color: t.grid } } },
      series: lines,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val, metric, series, ccy, themeV]);

  if (!val?.d.length) return null;
  const last = val.d.length - 1;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">Valuation over time</div>
          <div className="muted" style={{ fontSize: 'var(--step--2)' }}>
            Daily snapshot of Yahoo Finance multiples and analyst targets, recorded since {fmtDate(val.d[0])}.
          </div>
        </div>
        {option && available.length > 1 ? (
          <Segmented label="Measure" value={metric!} onChange={setPick} options={available.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
        ) : null}
      </div>
      {option ? (
        <div style={{ marginTop: 8 }}>
          {metric === 'tgt' ? (
            <div className="legend" style={{ marginBottom: 4 }}>
              <span>
                <i className="key" style={{ background: 'var(--accent)' }} />
                Close
              </span>
              <span>
                <i className="key" style={{ background: 'var(--ink-2)' }} />
                Target (mean)
              </span>
              <span>
                <i className="key dashed" style={{ '--key-color': 'var(--up)' } as React.CSSProperties} />
                Highest
              </span>
              <span>
                <i className="key dashed" style={{ '--key-color': 'var(--down)' } as React.CSSProperties} />
                Lowest
              </span>
            </div>
          ) : null}
          <EChart option={option} height={240} ariaLabel={`${METRIC_LABEL[metric!]} over time`} />
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 8, fontSize: 'var(--step--1)' }}>
          The chart appears after {MIN_POINTS} snapshots. Latest ({fmtDate(val.d[last])}): forward P/E {fmtMultiple(val.fpe[last])}, trailing {fmtMultiple(val.pe[last])}, EV/EBITDA{' '}
          {fmtMultiple(val.ev[last])}, target {fmtPrice(val.tgt[last], ccy)}.
        </p>
      )}
    </div>
  );
}

interface Row {
  label: string;
  then?: number | string | null;
  now?: number | string | null;
  kind: 'multiple' | 'price' | 'count' | 'text';
}

function pickAt(val: ValuationSeries | undefined, i: number) {
  if (!val || i < 0) return undefined;
  return { d: val.d[i], pe: val.pe[i], fpe: val.fpe[i], ev: val.ev[i], ps: val.ps[i], tgt: val.tgt[i], n: val.n[i], rec: val.rec[i] };
}

/**
 * View page: the valuation when the view opened against today's (or the day it closed).
 * Snapshots exist from the first recording day on; earlier views show today's values only.
 */
export function ValuationThenNow({ series, quote, from, to, ccy }: { series?: PriceSeries; quote?: Quote; from: string; to?: string; ccy?: string }) {
  const val = series?.val;
  const iThen = valuationNear(val, from.slice(0, 10));
  const thenSnap = iThen >= 0 && val && val.d[iThen] >= addDays(from.slice(0, 10), -7) ? pickAt(val, iThen) : undefined;
  const nowSnap = to ? pickAt(val, valuationNear(val, to.slice(0, 10))) : pickAt(val, (val?.d.length ?? 0) - 1);
  const now = nowSnap ?? (quote && !to ? { d: quote.d, pe: quote.pe ?? null, fpe: quote.fpe ?? null, ev: null, ps: quote.ps ?? null, tgt: quote.tgt ?? null, n: quote.tgtN ?? null, rec: quote.rec ?? null } : undefined);
  if (!now && !thenSnap) return null;
  // Targets: divide the earlier one by any split since, so the change is like for like.
  const tgtThen = thenSnap?.tgt != null ? thenSnap.tgt / (splitFactorSince(series?.splits, thenSnap.d) / splitFactorSince(series?.splits, now?.d ?? thenSnap.d)) : null;
  const rows: Row[] = [
    { label: 'Forward P/E', then: thenSnap?.fpe, now: now?.fpe, kind: 'multiple' },
    { label: 'Trailing P/E', then: thenSnap?.pe, now: now?.pe, kind: 'multiple' },
    { label: 'EV/EBITDA', then: thenSnap?.ev, now: now?.ev, kind: 'multiple' },
    { label: 'Price/sales', then: thenSnap?.ps, now: now?.ps, kind: 'multiple' },
    { label: 'Street target', then: tgtThen, now: now?.tgt, kind: 'price' },
    { label: 'Analysts', then: thenSnap?.n, now: now?.n, kind: 'count' },
    { label: 'Street rating', then: thenSnap?.rec ? REC_LABEL[thenSnap.rec] ?? thenSnap.rec : null, now: now?.rec ? REC_LABEL[now.rec] ?? now.rec : null, kind: 'text' },
  ].filter((r) => (r.then ?? null) !== null || (r.now ?? null) !== null) as Row[];
  if (!rows.length) return null;
  const show = (r: Row, v: Row['then']) =>
    v === null || v === undefined ? '—' : r.kind === 'multiple' ? fmtMultiple(v as number) : r.kind === 'price' ? fmtPrice(v as number, ccy) : String(v);
  return (
    <div className="card">
      <div className="eyebrow">Valuation {to ? 'at open and close' : 'then and now'}</div>
      <div className="table-wrap" style={{ marginTop: 6 }}>
        <table className="data compact">
          <thead>
            <tr>
              <th />
              <th className="n">{thenSnap ? fmtDate(thenSnap.d, false) : 'At open'}</th>
              <th className="n">{now ? (to ? fmtDate(now.d, false) : 'Now') : '—'}</th>
              <th className="n">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = typeof r.then === 'number' ? r.then : undefined;
              const b = typeof r.now === 'number' ? r.now : undefined;
              return (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="n">{show(r, r.then)}</td>
                  <td className="n">{show(r, r.now)}</td>
                  <td className="n">{a && b && r.kind !== 'count' ? <Change value={b / a - 1} /> : a !== undefined && b !== undefined && r.kind === 'count' ? (b - a > 0 ? `+${b - a}` : b - a < 0 ? `−${a - b}` : '0') : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 6 }}>
        {thenSnap
          ? 'Yahoo Finance snapshots on the nearest trading day.'
          : val?.d.length
            ? `Not recorded when the view opened: daily snapshots began on ${fmtDate(val.d[0])}.`
            : 'Daily snapshots of these figures begin with the next market-data run.'}
      </p>
    </div>
  );
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

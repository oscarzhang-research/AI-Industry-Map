// Chart components. All read colors from CSS tokens (chartTheme) and rebuild on theme change.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, chartTheme, tooltipBase, type ChartTheme } from './EChart.tsx';
import type { Company, IndexSeries, PriceSeries, Quote, SiteData, ThesisRecord } from '../lib/types.ts';
import { useThemeVersion } from '../lib/hooks.ts';
import { fmtCompact, fmtDate, fmtPct, fmtPrice } from '../lib/format.ts';
import { heatColor, heatLegend, type HeatPeriod } from './heat.ts';
import { indexOnOrBefore, splitFactorSince } from '../lib/finance.ts';
import { Segmented } from './ui.tsx';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------------------------------------
// Heatmap (treemap): layers -> industries -> companies, sized by market cap, colored by return.
// ---------------------------------------------------------------------------------------------
export function Heatmap({ site, quotes, period, height = 560 }: { site: SiteData; quotes: Record<string, Quote>; period: HeatPeriod; height?: number }) {
  const themeV = useThemeVersion();
  const navigate = useNavigate();
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const children = site.layers
      .slice()
      .sort((a, b) => b.order - a.order)
      .map((l) => ({
        name: `L${l.order} ${l.name}`,
        children: l.industries
          .map((ind) => {
            const leaves = new Map<string, unknown>();
            for (const seg of ind.segments)
              for (const id of seg.companies) {
                const c = site.companies[id];
                if (!c || c.listing !== 'listed' || !c.symbol || leaves.has(id)) continue;
                if (!c.primary.startsWith(ind.path)) continue; // count each company once, in its primary industry
                const q = quotes[c.symbol];
                if (!q) continue;
                const r = q.r[period];
                const col = r !== undefined ? heatColor(r, period) : { bg: t.hm.mid, fg: t.ink };
                leaves.set(id, {
                  name: c.symbol.includes('.') || c.symbol.length > 6 ? c.name : c.symbol,
                  value: Math.max(q.mcapUsd ?? 0, 2e9),
                  id,
                  ret: r,
                  full: c.name,
                  price: q.c,
                  ccy: q.ccy,
                  mcap: q.mcapUsd,
                  itemStyle: { color: col.bg },
                  label: { color: col.fg },
                });
              }
            return { name: ind.name, children: [...leaves.values()] };
          })
          .filter((x) => x.children.length),
      }));
    return {
      animation: false,
      tooltip: {
        ...tooltipBase(t),
        formatter: (p: { data: { full?: string; ret?: number; price?: number; ccy?: string; mcap?: number; name: string }; treePathInfo?: { name: string }[] }) => {
          const d = p.data;
          if (!d.full) return `<b>${esc(d.name)}</b>`;
          return `<div style="min-width:160px"><div style="font-weight:600">${esc(d.full)}</div>
            <div style="font-size:15px;font-weight:600;color:${(d.ret ?? 0) >= 0 ? t.up : t.down}">${fmtPct(d.ret)}</div>
            <div style="color:${t.muted}">${fmtPrice(d.price, d.ccy)} · mkt cap ${fmtCompact(d.mcap)}</div></div>`;
        },
      },
      series: [
        {
          type: 'treemap',
          data: children,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          label: { show: true, fontFamily: t.font, fontSize: 11, formatter: (p: { data: { name: string; ret?: number } }) => `${p.data.name}\n${fmtPct(p.data.ret)}`, lineHeight: 14 },
          upperLabel: { show: true, height: 18, color: t.ink2, fontFamily: t.font, fontSize: 11, fontWeight: 600 },
          itemStyle: { borderColor: t.surface, gapWidth: 2 },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 4 }, upperLabel: { show: false } }, // the virtual root
            { itemStyle: { borderColor: t.surface, borderWidth: 4, gapWidth: 2 }, upperLabel: { show: true, height: 22, fontSize: 12, color: t.ink, fontWeight: 700 } },
            { itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 1 }, upperLabel: { show: true } },
            { itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 1 } },
          ],
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, quotes, period, themeV]);
  return (
    <div>
      <EChart
        option={option}
        height={height}
        ariaLabel={`Heatmap of AI companies by market cap, colored by ${period} return`}
        onClick={(p) => {
          const id = (p.data as { id?: string } | undefined)?.id;
          if (id) navigate(`/company/${id}`);
        }}
      />
      <div className="chart-foot">
        <div className="scale-legend" aria-label="Color scale">
          {heatLegend(period).map((s, i) => (
            <span key={i} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <i style={{ background: `var(${s.var})` }} />
              <span style={{ minHeight: '1em' }}>{s.label}</span>
            </span>
          ))}
        </div>
        <span>Tile size: market cap (USD). Each company appears once, in its primary industry. Private companies are not shown.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Layer indices, rebased to 100 at the start of the chosen range: market-cap weighted by default,
// with the equal-weight view of the same companies one click away.
// ---------------------------------------------------------------------------------------------
type Range = 'ytd' | 'y1' | 'ai';
type Weighting = 'cap' | 'equal';

/** Round an axis end to two significant digits, outward, so the end labels read cleanly (92 → 90, 1555 → 1600). */
function niceEnd(x: number, dir: 'down' | 'up'): number {
  const mag = 10 ** (Math.floor(Math.log10(x)) - 1);
  return (dir === 'down' ? Math.floor(x / mag) : Math.ceil(x / mag)) * mag;
}

export function LayerChart({ series, layerNames, companyName }: { series: IndexSeries[]; layerNames: Record<string, { name: string; order: number }>; companyName?: (symbol: string) => string }) {
  const themeV = useThemeVersion();
  const [range, setRange] = useState<Range>('ai');
  const [weighting, setWeighting] = useState<Weighting>('cap');
  const [table, setTable] = useState(false);
  const kind = weighting === 'cap' ? 'layer' : 'layer-equal';
  const layers = series.filter((s) => s.kind === kind).sort((a, b) => layerNames[a.id].order - layerNames[b.id].order);
  const rebased = useMemo(() => {
    return layers.map((s) => {
      const last = s.d[s.d.length - 1];
      const start = range === 'ai' ? s.d[0] : range === 'ytd' ? `${last.slice(0, 4)}-01-01` : shiftYear(last, -1);
      let i0 = indexOnOrBefore(s.d, start);
      if (range === 'ytd' && s.d[i0] === start) i0 = i0 - 1;
      i0 = Math.max(0, i0);
      const base = s.v[i0];
      return { ...s, d: s.d.slice(i0), v: s.v.slice(i0).map((x) => (x / base) * 100) };
    });
  }, [layers, range]);
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    // Fixed log extent so end labels can be spread apart by hand (ECharts does not de-overlap them).
    const values = rebased.flatMap((s) => s.v);
    const lo = niceEnd(Math.min(...values) * 0.97, 'down');
    const hi = niceEnd(Math.max(...values) * 1.03, 'up');
    const plotH = 340 - 16 - 28;
    const yOf = (v: number) => ((Math.log2(hi) - Math.log2(v)) / (Math.log2(hi) - Math.log2(lo))) * plotH;
    const ends = rebased.map((s) => ({ id: s.id, y: yOf(s.v[s.v.length - 1]) })).sort((a, b) => a.y - b.y);
    const shift = new Map<string, number>();
    let prev = -Infinity;
    for (const e of ends) {
      const y = Math.max(e.y, prev + 14);
      shift.set(e.id, y - e.y);
      prev = y;
    }
    return {
      animation: false,
      grid: { left: 48, right: 128, top: 16, bottom: 28 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        valueFormatter: (v: number) => v.toFixed(1),
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'log',
        logBase: 2,
        axisLine: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => v.toFixed(0) },
        splitLine: { lineStyle: { color: t.grid } },
        min: lo,
        max: hi,
      },
      series: rebased.map((s) => ({
        name: `L${layerNames[s.id].order} ${layerNames[s.id].name}`,
        type: 'line',
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2, color: t.layer[s.id] },
        itemStyle: { color: t.layer[s.id], borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: 'series' },
        data: s.d.map((d, i) => [d, Math.round(s.v[i] * 10) / 10]),
        endLabel: {
          show: true,
          color: t.ink2,
          fontFamily: t.font,
          fontSize: 11,
          offset: [0, shift.get(s.id) ?? 0],
          formatter: (p: { value: [string, number] }) => `${layerNames[s.id].name} ${fmtPct(p.value[1] / 100 - 1, 0)}`,
        },
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebased, themeV]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="legend">
          {layers.map((s) => (
            <span key={s.id}>
              <i className="key" style={{ background: `var(--l${layerNames[s.id].order}-line)` }} />
              L{layerNames[s.id].order} {layerNames[s.id].name} <span className="faint">({s.members})</span>
            </span>
          ))}
        </div>
        <div className="row">
          <Segmented
            label="Weighting"
            value={weighting}
            onChange={setWeighting}
            options={[
              { value: 'cap', label: 'Market cap' },
              { value: 'equal', label: 'Equal' },
            ]}
          />
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'ytd', label: 'YTD' },
              { value: 'y1', label: '1Y' },
              { value: 'ai', label: 'Since 2023' },
            ]}
          />
          <button className="btn sm ghost" type="button" onClick={() => setTable((v) => !v)}>
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Layer</th>
                <th className="n">Members</th>
                <th className="n">Start</th>
                <th className="n">Latest</th>
                <th className="n">Return</th>
              </tr>
            </thead>
            <tbody>
              {rebased.map((s) => (
                <tr key={s.id}>
                  <td>
                    L{layerNames[s.id].order} {layerNames[s.id].name}
                  </td>
                  <td className="n">{s.members}</td>
                  <td className="n">{fmtDate(s.d[0])}</td>
                  <td className="n">{fmtDate(s.d[s.d.length - 1])}</td>
                  <td className="n">{fmtPct(s.v[s.v.length - 1] / 100 - 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EChart option={option} height={340} ariaLabel={`${weighting === 'cap' ? 'Market-cap-weighted' : 'Equal-weight'} price index of each layer`} />
      )}
      {weighting === 'cap' && layers.some((s) => s.top?.length) ? (
        <div className="chart-foot" style={{ justifyContent: 'flex-start' }}>
          <span className="ink2">Largest weights today:</span>
          {layers.map((s) =>
            s.top?.length ? (
              <span key={s.id}>
                {layerNames[s.id].name} {s.top.map((x) => `${companyName?.(x.s) ?? x.s} ${Math.round(x.w * 100)}%`).join(', ')}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
      <div className="chart-foot">
        <span>
          {weighting === 'cap'
            ? 'Each line is the combined market value of the listed companies whose main business is in that layer, weighted by market cap in US dollars; returns in local currencies, log scale. A few large companies move each line. For orientation, not a tradable index.'
            : 'Each line gives every listed core and focus company in the layer the same weight, so smaller companies count as much as the largest; local currencies, log scale. For orientation, not a tradable index.'}
        </span>
      </div>
    </div>
  );
}

function shiftYear(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Price chart with thesis overlays: base, target, stop, scenario band and version markers.
// ---------------------------------------------------------------------------------------------
export interface Overlay {
  thesis: ThesisRecord;
  showTarget: boolean;
}

export function PriceChart({
  series,
  overlays = [],
  ccy,
  height = 360,
  defaultRange = '1y',
}: {
  series: PriceSeries;
  overlays?: Overlay[];
  ccy?: string;
  height?: number;
  defaultRange?: '6m' | '1y' | '2y' | 'all';
}) {
  const themeV = useThemeVersion();
  const [range, setRange] = useState<'6m' | '1y' | '2y' | 'all'>(defaultRange);
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const last = series.d[series.d.length - 1];
    const firstOverlay = overlays.map((o) => o.thesis.createdAt.slice(0, 10)).sort()[0];
    let start = range === 'all' ? series.d[0] : shiftMonths(last, range === '6m' ? -6 : range === '1y' ? -12 : -24);
    if (firstOverlay && firstOverlay < start) start = shiftMonths(firstOverlay, -1);
    const i0 = Math.max(0, indexOnOrBefore(series.d, start));
    const data = series.d.slice(i0).map((d, i) => [d, series.c[i0 + i]]);
    const markLines: unknown[] = [];
    const markPoints: unknown[] = [];
    const markAreas: unknown[] = [];
    for (const { thesis: th, showTarget } of overlays) {
      const f = splitFactorSince(series.splits, th.createdAt);
      const from = th.createdAt.slice(0, 10);
      const to = th.closed?.date?.slice(0, 10) ?? last;
      const base = th.basePrice?.price ? th.basePrice.price / f : undefined;
      if (base) markLines.push(seg(from, to, base, `Base ${fmtPrice(base, ccy)}`, t.ink2, 'solid', t.surface));
      if (showTarget && th.target?.price) markLines.push(seg(from, to, th.target.price / f, `Target ${fmtPrice(th.target.price / f, ccy)}`, t.up, 'dashed', t.surface));
      if (showTarget && th.stop?.price) markLines.push(seg(from, to, th.stop.price / f, `Stop ${fmtPrice(th.stop.price / f, ccy)}`, t.down, 'dashed', t.surface));
      if (showTarget && th.scenarios?.length) {
        const ps = th.scenarios.map((s) => s.price / f);
        markAreas.push([
          { xAxis: from, yAxis: Math.min(...ps), itemStyle: { color: t.accent, opacity: 0.06 } },
          { xAxis: to, yAxis: Math.max(...ps) },
        ]);
      }
      const versions = th.versions?.length ? th.versions : [{ at: th.createdAt, reason: 'Opened', direction: th.direction }];
      for (const v of versions) {
        const day = v.at.slice(0, 10);
        const k = indexOnOrBefore(series.d, day);
        if (k < 0) continue;
        markPoints.push({
          coord: [series.d[k], series.c[k]],
          symbol: 'circle',
          symbolSize: 10,
          itemStyle: { color: th.direction === 'short' ? t.down : th.direction === 'long' ? t.up : t.ink2, borderColor: t.surface, borderWidth: 2 },
          label: { show: false },
          tip: `${fmtDate(day)} · ${v.reason}`,
        });
      }
    }
    return {
      animation: false,
      grid: { left: 64, right: 20, top: 18, bottom: 28 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        formatter: (ps: { value: [string, number] }[]) => {
          const p = ps[0];
          return p ? `<div style="color:${t.muted}">${fmtDate(p.value[0])}</div><div style="font-weight:600;font-size:14px">${fmtPrice(p.value[1], ccy)}</div>` : '';
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => fmtPrice(v) },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          type: 'line',
          name: 'Close',
          data,
          showSymbol: false,
          lineStyle: { width: 2, color: t.accent },
          areaStyle: { color: t.accent, opacity: 0.06 },
          markLine: { symbol: 'none', silent: true, data: markLines, animation: false },
          markPoint: {
            data: markPoints,
            tooltip: { formatter: (p: { data: { tip: string } }) => esc(p.data.tip) },
          },
          markArea: { silent: true, data: markAreas },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, overlays, range, ccy, themeV]);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
        <Segmented
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '6m', label: '6M' },
            { value: '1y', label: '1Y' },
            { value: '2y', label: '2Y' },
            { value: 'all', label: 'Since 2022' },
          ]}
        />
      </div>
      <EChart option={option} height={height} ariaLabel="Price history with view markers" />
    </div>
  );
}

function seg(from: string, to: string, y: number, label: string, color: string, type: 'solid' | 'dashed', bg: string) {
  return [
    {
      coord: [from, y],
      lineStyle: { color, width: 1.5, type },
      label: { show: true, position: 'insideEndTop', formatter: label, color, fontSize: 11, fontWeight: 600, backgroundColor: bg, padding: [1, 4], borderRadius: 3 },
    },
    { coord: [to, y] },
  ];
}

function shiftMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Relative performance since a view was opened: the subject and its benchmark, both rebased to 100.
// ---------------------------------------------------------------------------------------------
export function RelativeChart({
  a,
  b,
  from,
  to,
  labelA,
  labelB,
  height = 240,
}: {
  a: PriceSeries;
  b?: PriceSeries;
  from: string;
  to?: string;
  labelA: string;
  labelB?: string;
  height?: number;
}) {
  const themeV = useThemeVersion();
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const rebase = (s: PriceSeries) => {
      const i0 = Math.max(0, indexOnOrBefore(s.d, from.slice(0, 10)));
      const i1 = to ? Math.max(i0, indexOnOrBefore(s.d, to.slice(0, 10))) : s.d.length - 1;
      const base = s.c[i0];
      const out: [string, number][] = [];
      for (let i = i0; i <= i1; i++) out.push([s.d[i], Math.round((s.c[i] / base) * 1000) / 10]);
      return out;
    };
    const lines = [
      { name: labelA, data: rebase(a), color: t.accent, type: 'solid' as const, width: 2 },
      ...(b && labelB ? [{ name: labelB, data: rebase(b), color: t.muted, type: 'dashed' as const, width: 1.5 }] : []),
    ];
    return {
      animation: false,
      grid: { left: 44, right: 120, top: 14, bottom: 26 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.axis } },
        valueFormatter: (v: number) => fmtPct(v / 100 - 1),
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => fmtPct(v / 100 - 1, 0) },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: lines.map((l) => ({
        name: l.name,
        type: 'line',
        showSymbol: false,
        data: l.data,
        lineStyle: { width: l.width, color: l.color, type: l.type },
        itemStyle: { color: l.color },
        endLabel: {
          show: true,
          color: t.ink2,
          fontFamily: t.font,
          fontSize: 11,
          formatter: (p: { value: [string, number] }) => `${l.name} ${fmtPct(p.value[1] / 100 - 1)}`,
        },
        labelLayout: { moveOverlap: 'shiftY' },
        markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: t.axis, width: 1 }, data: [{ yAxis: 100 }] },
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, from, to, labelA, labelB, themeV]);
  return (
    <div>
      <div className="legend" style={{ marginBottom: 4 }}>
        <span>
          <i className="key" style={{ background: 'var(--accent)' }} />
          {labelA}
        </span>
        {b && labelB ? (
          <span>
            <i className="key dashed" />
            {labelB}
          </span>
        ) : null}
      </div>
      <EChart option={option} height={height} ariaLabel={`${labelA} versus ${labelB ?? 'benchmark'} since the view opened`} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Risk / reward scatter: conviction vs remaining upside to target.
// ---------------------------------------------------------------------------------------------
export interface ScatterPoint {
  id: string;
  label: string;
  conviction: number;
  upside: number;
  direction: string;
}

export function RiskRewardScatter({ points, onPick }: { points: ScatterPoint[]; onPick: (id: string) => void }) {
  const themeV = useThemeVersion();
  const option = useMemo<EChartsCoreOption>(() => {
    const t: ChartTheme = chartTheme();
    const jitter = (id: string) => ((id.length * 37) % 9) / 40 - 0.1;
    return {
      animation: false,
      grid: { left: 52, right: 24, top: 18, bottom: 40 },
      tooltip: {
        ...tooltipBase(t),
        formatter: (p: { data: { label: string; value: [number, number] } }) =>
          `<b>${esc(p.data.label)}</b><br/>Conviction ${Math.round(p.data.value[0])} · upside ${fmtPct(p.data.value[1])}`,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 6,
        interval: 1,
        name: 'Conviction',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: t.text, fontFamily: t.font },
        axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.text, formatter: (v: number) => (v >= 1 && v <= 5 ? String(v) : '') },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Upside to target',
        nameTextStyle: { color: t.text, fontFamily: t.font },
        axisLabel: { color: t.text, formatter: (v: number) => fmtPct(v, 0) },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 12,
          data: points.map((p) => ({
            id: p.id,
            label: p.label,
            value: [p.conviction + jitter(p.id), p.upside],
            itemStyle: { color: p.direction === 'short' ? t.down : t.up, borderColor: t.surface, borderWidth: 2 },
          })),
          label: { show: true, position: 'right', formatter: (p: { data: { label: string } }) => p.data.label, color: t.ink2, fontSize: 11, fontFamily: t.font },
          emphasis: { scale: 1.4 },
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, themeV]);
  return (
    <EChart
      option={option}
      height={320}
      ariaLabel="Views by conviction and remaining upside"
      onClick={(p) => {
        const id = (p.data as { id?: string } | undefined)?.id;
        if (id) onPick(id);
      }}
    />
  );
}

export function companySpark(company: Company): string {
  return company.id;
}

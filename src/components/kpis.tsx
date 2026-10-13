// Industry indicator cards (layer pages, /indicators) and the reported-revenue chart on company pages.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import type { Financials, Kpi, KpiGrowthTable, KpiMonthly, KpiRanges, KpiStack, KpiValuations } from '../lib/types.ts';
import { EChart, chartTheme, tooltipBase } from './EChart.tsx';
import { Change, LayerBadge, Segmented } from './ui.tsx';
import { heatColor } from './heat.ts';
import { useThemeVersion } from '../lib/hooks.ts';
import { useStore } from '../lib/store.tsx';
import { fmtCompact, fmtDate, fmtPct } from '../lib/format.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026Q3' -> '3Q26' */
export const quarterLabel = (p: string) => (/^\d{4}Q[1-4]$/.test(p) ? `${p[5]}Q${p.slice(2, 4)}` : p);
/** '2026-09' -> 'Sep 26' (short) or 'Sep 2026' */
export const monthLabel = (m: string, long = false) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${long ? m.slice(0, 4) : m.slice(2, 4)}`;

const axisBase = (t: ReturnType<typeof chartTheme>) => ({
  axisLine: { lineStyle: { color: t.axis } },
  axisTick: { show: false },
  axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11 },
});

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One indicator: headline figure, chart or table, description and sources. */
export function KpiCard({ kpi, showLayer = false }: { kpi: Kpi; showLayer?: boolean }) {
  const { index } = useStore();
  const layerName = index.layerById.get(kpi.layer)?.name;
  return (
    <article className="card kpi-card min0" id={kpi.id}>
      <header className="kpi-head">
        <div className="min0">
          {showLayer ? (
            <div style={{ marginBottom: 6 }}>
              <LayerBadge layer={kpi.layer} name={layerName} />
            </div>
          ) : null}
          <h3>{kpi.name}</h3>
          <Headline kpi={kpi} />
        </div>
      </header>
      <p className="muted kpi-desc">{kpi.description}</p>
      <div className="kpi-body">
        {kpi.kind === 'stack' ? <StackChart kpi={kpi} /> : null}
        {kpi.kind === 'monthly' ? <MonthlyChart kpi={kpi} /> : null}
        {kpi.kind === 'growth-table' ? <GrowthTable kpi={kpi} /> : null}
        {kpi.kind === 'ranges' ? <RangesChart kpi={kpi} /> : null}
        {kpi.kind === 'valuations' ? <ValuationBars kpi={kpi} /> : null}
      </div>
      <footer className="chart-foot">
        {kpi.note ? <span>{kpi.note}</span> : null}
        <span>
          Source:{' '}
          {kpi.kind === 'ranges' ? (
            <>TrendForce press releases (each bar links its release in the tooltip)</>
          ) : (
            kpi.sources.map((s, i) => (
              <span key={s.name}>
                {i ? '; ' : ''}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </span>
            ))
          )}
          .
        </span>
      </footer>
    </article>
  );
}

function Headline({ kpi }: { kpi: Kpi }) {
  if (kpi.kind === 'stack') {
    const i = kpi.complete.lastIndexOf(true);
    if (i < 0) return null;
    const prev = i >= 4 && kpi.complete[i - 4] ? kpi.total[i - 4] : null;
    const v = kpi.total[i]!;
    return (
      <div className="kpi-headline">
        <span className="big num">{fmtCompact(v, kpi.unit ?? 'USD')}</span>
        {prev ? <Change value={v / prev - 1} /> : null}
        <span className="muted">
          in {quarterLabel(kpi.periods[i])}
          {prev ? ', year on year' : ''}
        </span>
      </div>
    );
  }
  if (kpi.kind === 'monthly') {
    const i = kpi.values.length - 1;
    return (
      <div className="kpi-headline">
        <span className="big num">{fmtCompact(kpi.values[i], kpi.unit ?? 'TWD')}</span>
        {kpi.yoy[i] !== null ? <Change value={kpi.yoy[i]} /> : null}
        <span className="muted">in {monthLabel(kpi.months[i], true)}, year on year</span>
      </div>
    );
  }
  if (kpi.kind === 'growth-table') {
    const last = kpi.periods.length - 1;
    const vals = kpi.rows.map((r) => r.values[last]).filter((v): v is number => v !== null);
    const m = median(vals);
    if (m === undefined) return null;
    return (
      <div className="kpi-headline">
        <span className="big num">
          <Change value={m} digits={0} />
        </span>
        <span className="muted">
          median growth, {kpi.frequency === 'month' ? monthLabel(kpi.periods[last], true) : quarterLabel(kpi.periods[last])} ({vals.length} of {kpi.rows.length} reported)
        </span>
      </div>
    );
  }
  if (kpi.kind === 'ranges') {
    const latest = kpi.series
      .map((s) => ({ s, p: s.points.filter((p) => p.basis === 'actual').pop() }))
      .filter((x) => x.p);
    if (!latest.length) return null;
    return (
      <div className="kpi-headline">
        {latest.map(({ s, p }) => (
          <span key={s.id} className="kpi-pair">
            <span className="muted">
              {s.label.split(' ')[0]} {p!.period}
            </span>{' '}
            <span className="big num">{rangeText(p!.low, p!.high)}</span>
          </span>
        ))}
        <span className="muted">latest reported, quarter on quarter</span>
      </div>
    );
  }
  if (kpi.kind === 'valuations') {
    const top = kpi.items[0];
    return (
      <div className="kpi-headline">
        <span className="big num">{fmtCompact(top.usd)}</span>
        <span className="muted">
          {top.label}, the most valuable of {kpi.items.length} labs{top.date ? ` (${monthLabel(top.date, true)})` : ''}
        </span>
      </div>
    );
  }
  return null;
}

/** '#2a78d6' -> 'rgba(42,120,214,a)'; other color strings pass through. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function rangeText(low: number, high: number): string {
  const f = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}%`;
  return low === high ? f(low) : `${f(low)} to ${f(high)}`;
}

function SeriesLegend({ items }: { items: { label: string; color: string; dashed?: boolean; faint?: boolean }[] }) {
  return (
    <div className="legend" style={{ marginBottom: 4 }}>
      {items.map((it) => (
        <span key={it.label}>
          <i className="sw" style={{ background: it.color, opacity: it.faint ? 0.4 : 1, outline: it.faint ? `1px solid ${it.color}` : undefined }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function StackChart({ kpi }: { kpi: KpiStack }) {
  const themeV = useThemeVersion();
  const colors = useMemo(() => chartTheme().series, [themeV]); // eslint-disable-line react-hooks/exhaustive-deps
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const ccy = kpi.unit ?? 'USD';
    return {
      animation: false,
      grid: { left: 56, right: 8, top: 10, bottom: 24 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const rows = kpi.parts
            .map((p, k) => `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[k]};margin-right:6px"></span>${esc(p.label)}: <b>${p.values[i] === null ? 'not reported' : fmtCompact(p.values[i]!, ccy)}</b></div>`)
            .join('');
          const tot = kpi.total[i];
          return `<div style="color:${t.muted}">${quarterLabel(kpi.periods[i])}${kpi.complete[i] ? '' : ' · not all reported'}</div>${rows}<div style="margin-top:4px">Total <b>${tot === null ? '—' : fmtCompact(tot, ccy)}</b></div>`;
        },
      },
      xAxis: { type: 'category', data: kpi.periods.map(quarterLabel), ...axisBase(t) },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => fmtCompact(v, ccy) }, splitLine: { lineStyle: { color: t.grid } } },
      series: kpi.parts.map((p, k) => ({
        type: 'bar',
        name: p.label,
        stack: 'total',
        barMaxWidth: 30,
        data: p.values.map((v, i) => ({ value: v ?? '-', itemStyle: { opacity: kpi.complete[i] ? 1 : 0.45 } })),
        itemStyle: { color: colors[k], borderColor: t.surface, borderWidth: 1 },
        emphasis: { disabled: true },
      })),
    };
  }, [kpi, colors, themeV]);
  return (
    <div>
      <SeriesLegend items={kpi.parts.map((p, k) => ({ label: p.label, color: colors[k] }))} />
      <EChart option={option} height={240} ariaLabel={`${kpi.name} by quarter`} />
      {kpi.complete.some((c) => !c) ? (
        <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 2 }}>
          Faded bars: quarters not every company has reported yet.
        </p>
      ) : null}
    </div>
  );
}

function MonthlyChart({ kpi }: { kpi: KpiMonthly }) {
  const themeV = useThemeVersion();
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const ccy = kpi.unit ?? 'TWD';
    return {
      animation: false,
      grid: { left: 56, right: 8, top: 10, bottom: 24 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const y = kpi.yoy[i];
          return `<div style="color:${t.muted}">${monthLabel(kpi.months[i], true)}</div><div style="font-weight:600;font-size:14px">${fmtCompact(kpi.values[i], ccy)}</div>${y !== null ? `<div style="color:${y >= 0 ? t.up : t.down}">${fmtPct(y)} year on year</div>` : ''}`;
        },
      },
      xAxis: { type: 'category', data: kpi.months.map((m) => monthLabel(m)), ...axisBase(t) },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => fmtCompact(v, ccy) }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: 'bar', data: kpi.values, barMaxWidth: 16, itemStyle: { color: t.accent, borderRadius: [2, 2, 0, 0] }, emphasis: { disabled: true } }],
    };
  }, [kpi, themeV]);
  return <EChart option={option} height={220} ariaLabel={`${kpi.name} by month`} />;
}

function GrowthTable({ kpi }: { kpi: KpiGrowthTable }) {
  const { site } = useStore();
  useThemeVersion();
  const label = (p: string) => (kpi.frequency === 'month' ? monthLabel(p) : quarterLabel(p));
  return (
    <div className="table-wrap">
      <table className="data compact growth">
        <thead>
          <tr>
            <th>Company</th>
            {kpi.periods.map((p) => (
              <th key={p} className="n">
                {label(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kpi.rows.map((r) => (
            <tr key={r.company}>
              <td>
                <Link to={`/company/${r.company}`}>{site.companies[r.company]?.name ?? r.label}</Link>
              </td>
              {r.values.map((v, i) => {
                const c = v === null ? undefined : heatColor(v, 'y1');
                return (
                  <td key={kpi.periods[i]} className="n heat" style={c ? { background: c.bg, color: c.fg } : undefined} title={v === null ? 'Not reported' : `${label(kpi.periods[i])}: ${fmtPct(v)} year on year`}>
                    {v === null ? '' : fmtPct(v, 0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangesChart({ kpi }: { kpi: KpiRanges }) {
  const themeV = useThemeVersion();
  const t0 = useMemo(() => chartTheme(), [themeV]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = [t0.series[0], t0.series[1]];
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    const key = (p: string) => `20${p.slice(2)}-${p[0]}`;
    const periods = [...new Set(kpi.series.flatMap((s) => s.points.map((p) => p.period)))].sort((a, b) => key(a).localeCompare(key(b)));
    const n = kpi.series.length;
    return {
      animation: false,
      grid: { left: 44, right: 8, top: 12, bottom: 24 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'item',
        enterable: true,
        formatter: (p: { seriesIndex: number; dataIndex: number }) => {
          const s = kpi.series[p.seriesIndex];
          const pt = s?.points[p.dataIndex];
          if (!pt) return '';
          return `<div style="color:${t.muted}">${esc(s.label)} · ${pt.period}</div><div style="font-weight:600;font-size:14px">${rangeText(pt.low, pt.high)}</div><div>${pt.basis === 'actual' ? 'Reported' : 'Forecast'}${pt.published ? `, published ${fmtDate(pt.published)}` : ''}</div>${pt.note ? `<div>${esc(pt.note)}</div>` : ''}${pt.url ? `<div style="margin-top:4px"><a href="${esc(pt.url)}" target="_blank" rel="noopener noreferrer">TrendForce release</a></div>` : ''}`;
        },
      },
      xAxis: { type: 'category', data: periods, ...axisBase(t), axisLine: { onZero: false, lineStyle: { color: t.axis } } },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        ...kpi.series.map((s, si) => ({
          type: 'custom',
          name: s.label,
          data: s.points.map((p) => [periods.indexOf(p.period), p.low, p.high, p.basis === 'actual' ? 1 : 0]),
          encode: { x: 0, y: [1, 2] },
          renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
            const x = api.value(0);
            const [cx, yLo] = api.coord([x, api.value(1)]);
            const [, yHi] = api.coord([x, api.value(2)]);
            const band = api.size([1, 0])[0];
            const w = Math.max(4, Math.min(16, band * 0.3));
            const off = (si - (n - 1) / 2) * (w + 3);
            const top = Math.min(yLo, yHi);
            const h = Math.max(3, Math.abs(yLo - yHi));
            const actual = api.value(3) === 1;
            return {
              type: 'rect',
              shape: { x: cx + off - w / 2, y: h === 3 ? top - 1.5 : top, width: w, height: h, r: 2 },
              style: { fill: actual ? colors[si] : withAlpha(colors[si], 0.28), stroke: colors[si], lineWidth: actual ? 0 : 1.25 },
            };
          },
        })),
        { type: 'line', data: [], markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: t.axis, width: 1, type: 'solid' }, data: [{ yAxis: 0 }] } },
      ],
    };
  }, [kpi, themeV]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <SeriesLegend
        items={[
          ...kpi.series.map((s, i) => ({ label: s.label, color: colors[i] })),
          { label: 'Outlined: forecast · solid: reported', color: t0.muted, faint: true },
        ]}
      />
      <EChart option={option} height={240} ariaLabel={`${kpi.name}, quarter on quarter`} />
    </div>
  );
}

function ValuationBars({ kpi }: { kpi: KpiValuations }) {
  const themeV = useThemeVersion();
  const navigate = useNavigate();
  const items = useMemo(() => [...kpi.items].reverse(), [kpi]); // largest at the top
  const option = useMemo<EChartsCoreOption>(() => {
    const t = chartTheme();
    return {
      animation: false,
      grid: { left: 118, right: 92, top: 4, bottom: 4 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const it = items[p.dataIndex];
          return `<div style="font-weight:600">${esc(it.label)}</div><div style="font-size:14px;font-weight:600">${fmtCompact(it.usd)}</div><div style="color:${t.muted}">${[it.round, it.date].filter(Boolean).map((x) => esc(x!)).join(' · ')}</div>`;
        },
      },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: items.map((i) => i.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink2, fontFamily: t.font, fontSize: 12 } },
      series: [
        {
          type: 'bar',
          data: items.map((i) => i.usd),
          barMaxWidth: 16,
          itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: t.ink2, fontFamily: t.font, fontSize: 11, formatter: (p: { dataIndex: number }) => `${fmtCompact(items[p.dataIndex].usd)}${items[p.dataIndex].date ? ` · ${items[p.dataIndex].date}` : ''}` },
          emphasis: { disabled: true },
          cursor: 'pointer',
        },
      ],
    };
  }, [items, themeV]);
  return <EChart option={option} height={Math.max(160, items.length * 28 + 12)} ariaLabel={`${kpi.name}, latest valuations`} onClick={(p) => p.dataIndex !== undefined && navigate(`/company/${items[p.dataIndex].company}`)} />;
}

/** Company page: quarterly revenue and capex from filings, or Taiwan monthly revenue. */
export function ReportedFigures({ fin }: { fin: Financials }) {
  const themeV = useThemeVersion();
  const hasCapex = !!fin.quarters?.some((q) => q.capex);
  const [measure, setMeasure] = useState<'revenue' | 'capex'>('revenue');
  const m = hasCapex ? measure : 'revenue';
  const ccy = fin.ccy ?? 'USD';
  const option = useMemo<EChartsCoreOption | null>(() => {
    const t = chartTheme();
    const quarterly = !!fin.quarters?.length;
    const labels = quarterly ? fin.quarters!.map((q) => quarterLabel(q.period)) : (fin.months ?? []).map((x) => monthLabel(x.month));
    const values = quarterly ? fin.quarters!.map((q) => (m === 'capex' ? (q.capex ?? null) : (q.revenue ?? null))) : (fin.months ?? []).map((x) => x.revenue);
    if (!values.some((v) => v !== null)) return null;
    const growth = values.map((v, i) => {
      const back = quarterly ? 4 : 12;
      const prev = i >= back ? values[i - back] : null;
      return v !== null && prev ? v / prev - 1 : quarterly ? null : (fin.months?.[i]?.yoy ?? null);
    });
    return {
      animation: false,
      grid: { left: 56, right: 8, top: 10, bottom: 24 },
      tooltip: {
        ...tooltipBase(t),
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.5 } },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const g = growth[i];
          const end = quarterly ? fin.quarters![i].end : undefined;
          return `<div style="color:${t.muted}">${labels[i]}${end ? ` · quarter to ${fmtDate(end)}` : ''}</div><div style="font-weight:600;font-size:14px">${values[i] === null ? '—' : fmtCompact(values[i]!, ccy)}</div>${g !== null ? `<div style="color:${g >= 0 ? t.up : t.down}">${fmtPct(g)} year on year</div>` : ''}`;
        },
      },
      xAxis: { type: 'category', data: labels, ...axisBase(t) },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: t.text, fontFamily: t.font, fontSize: 11, formatter: (v: number) => fmtCompact(v, ccy) }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: 'bar', data: values.map((v) => v ?? '-'), barMaxWidth: quarterly ? 26 : 14, itemStyle: { color: m === 'capex' ? t.ink2 : t.accent, borderRadius: [2, 2, 0, 0] }, emphasis: { disabled: true } }],
    };
  }, [fin, m, ccy, themeV]);
  if (!option) return null;
  const quarterly = !!fin.quarters?.length;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">{quarterly ? 'Reported by quarter' : 'Monthly revenue'}</div>
          <div className="muted" style={{ fontSize: 'var(--step--2)' }}>
            {quarterly ? 'From SEC filings, by calendar quarter. Capital spending is cash paid for property and equipment.' : 'From Taiwan’s monthly revenue reports, filed by the tenth of the next month.'}
          </div>
        </div>
        {hasCapex ? (
          <Segmented
            label="Measure"
            value={m}
            onChange={setMeasure}
            options={[
              { value: 'revenue', label: 'Revenue' },
              { value: 'capex', label: 'Capital spending' },
            ]}
          />
        ) : null}
      </div>
      <div style={{ marginTop: 8 }}>
        <EChart option={option} height={220} ariaLabel={quarterly ? `Quarterly ${m === 'capex' ? 'capital spending' : 'revenue'}` : 'Monthly revenue'} />
      </div>
    </div>
  );
}

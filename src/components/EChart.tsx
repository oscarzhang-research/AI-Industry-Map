import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, TreemapChart, ScatterChart, BarChart, CustomChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  DataZoomComponent,
  AriaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  LineChart,
  TreemapChart,
  ScatterChart,
  BarChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  DataZoomComponent,
  AriaComponent,
  CanvasRenderer,
]);

export type ChartClick = (params: { data?: unknown; name?: string; dataIndex?: number; seriesIndex?: number }) => void;

/** Thin React wrapper around ECharts. The option is rebuilt by the caller when data or theme change. */
export function EChart({
  option,
  height = 320,
  onClick,
  ariaLabel,
}: {
  option: EChartsCoreOption;
  height?: number | string;
  onClick?: ChartClick;
  ariaLabel: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef<ChartClick | undefined>(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    // English labels whatever the browser language (ECharts otherwise follows navigator.language).
    const c = echarts.init(el.current, undefined, { renderer: 'canvas', locale: 'EN' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p as Parameters<ChartClick>[0]));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return <div ref={el} className="chart-box" style={{ height }} role="img" aria-label={ariaLabel} />;
}

/** Read chart chrome colors from CSS tokens so charts follow the light/dark theme. */
export function chartTheme() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: v('--chart-surface'),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    text: v('--chart-text'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    up: v('--up'),
    down: v('--down'),
    accent: v('--accent'),
    deemph: v('--deemph'),
    layer: {
      energy: v('--l1-line'),
      chips: v('--l2-line'),
      infrastructure: v('--l3-line'),
      models: v('--l4-line'),
      applications: v('--l5-line'),
    } as Record<string, string>,
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    hm: {
      mid: v('--hm-mid'),
      up: [1, 2, 3, 4, 5].map((i) => v(`--hm-up-${i}`)),
      down: [1, 2, 3, 4, 5].map((i) => v(`--hm-dn-${i}`)),
    },
    font: v('--font-sans') || 'system-ui, sans-serif',
    mono: v('--font-mono') || 'monospace',
  };
}

export type ChartTheme = ReturnType<typeof chartTheme>;

export function tooltipBase(t: ChartTheme) {
  return {
    backgroundColor: t.surface,
    borderColor: t.axis,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.ink, fontFamily: t.font, fontSize: 12 },
    extraCssText: 'box-shadow: 0 8px 24px -12px rgba(0,0,0,.35); border-radius: 8px;',
  };
}

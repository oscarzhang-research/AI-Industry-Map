import { useEffect, useRef, useState } from 'react';
import { loadEarnings, loadIndices, loadKpis, loadSeries } from './data.ts';
import type { EarningsFile, IndicesFile, KpisFile, PriceSeries } from './types.ts';

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function useSeries(symbol: string | undefined): { series?: PriceSeries; loading: boolean } {
  const [state, setState] = useState<{ series?: PriceSeries; loading: boolean }>({ loading: !!symbol });
  useEffect(() => {
    let alive = true;
    if (!symbol) {
      setState({ loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    loadSeries(symbol).then((series) => alive && setState({ series, loading: false }));
    return () => {
      alive = false;
    };
  }, [symbol]);
  return state;
}

export function useSeriesMany(symbols: (string | undefined)[]): Map<string, PriceSeries> {
  const key = symbols.filter(Boolean).join('|');
  const [map, setMap] = useState<Map<string, PriceSeries>>(new Map());
  useEffect(() => {
    let alive = true;
    const list = [...new Set(symbols.filter(Boolean) as string[])];
    Promise.all(list.map((s) => loadSeries(s).then((x) => [s, x] as const))).then((pairs) => {
      if (!alive) return;
      const m = new Map<string, PriceSeries>();
      for (const [s, x] of pairs) if (x) m.set(s, x);
      setMap(m);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

export function useIndices(): IndicesFile | null {
  const [d, setD] = useState<IndicesFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadIndices().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

/** Consensus and results around earnings reports (generated/earnings.json); empty until loaded. */
export function useEarnings(): EarningsFile {
  const [d, setD] = useState<EarningsFile>({});
  useEffect(() => {
    let alive = true;
    loadEarnings().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

/** Industry indicators (generated/kpis.json); null until loaded. */
export function useKpis(): KpisFile | null {
  const [d, setD] = useState<KpisFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadKpis().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

/** Re-render when the color theme changes (charts read CSS tokens at render time). */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setV((x) => x + 1);
    mq.addEventListener('change', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-updown'] });
    return () => {
      mq.removeEventListener('change', bump);
      mo.disconnect();
    };
  }, []);
  return v;
}

export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

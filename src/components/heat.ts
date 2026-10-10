// Diverging color scale for returns (heatmap tiles, tinted chips). Five steps per arm and a neutral middle.
export type HeatPeriod = 'd1' | 'w1' | 'm1' | 'm3' | 'ytd' | 'y1' | 'ai';

// Step thresholds (absolute return) per period: the 1st..4th boundaries between the five steps.
const THRESHOLDS: Record<HeatPeriod, number[]> = {
  d1: [0.005, 0.015, 0.03, 0.05],
  w1: [0.01, 0.03, 0.06, 0.1],
  m1: [0.02, 0.05, 0.1, 0.2],
  m3: [0.04, 0.1, 0.2, 0.35],
  ytd: [0.05, 0.15, 0.35, 0.7],
  y1: [0.05, 0.15, 0.35, 0.7],
  ai: [0.1, 0.5, 1.5, 4],
};

export function heatStep(value: number, period: HeatPeriod): number {
  const t = THRESHOLDS[period];
  const a = Math.abs(value);
  let step = 0;
  for (let i = 0; i < t.length; i++) if (a >= t[i]) step = i + 1;
  return value >= 0 ? step : -step; // -5..5 with 0 = neutral (|value| below the first threshold)
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Background + text color for a value, read from the current theme's tokens. */
export function heatColor(value: number, period: HeatPeriod): { bg: string; fg: string } {
  const step = heatStep(value, period);
  if (step === 0) return { bg: cssVar('--hm-mid'), fg: cssVar('--ink') };
  const name = step > 0 ? `--hm-up-${step}` : `--hm-dn-${-step}`;
  const strong = Math.abs(step) >= 4;
  return { bg: cssVar(name), fg: strong ? '#ffffff' : cssVar('--ink') };
}

export function heatLegend(period: HeatPeriod): { label: string; var: string }[] {
  const t = THRESHOLDS[period];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [
    { label: `≤ −${pct(t[3])}`, var: '--hm-dn-5' },
    { label: '', var: '--hm-dn-4' },
    { label: '', var: '--hm-dn-3' },
    { label: '', var: '--hm-dn-2' },
    { label: '', var: '--hm-dn-1' },
    { label: '0', var: '--hm-mid' },
    { label: '', var: '--hm-up-1' },
    { label: '', var: '--hm-up-2' },
    { label: '', var: '--hm-up-3' },
    { label: '', var: '--hm-up-4' },
    { label: `≥ +${pct(t[3])}`, var: '--hm-up-5' },
  ];
}

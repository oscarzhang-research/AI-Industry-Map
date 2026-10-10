// Display formatting. Pure functions; safe in Node tests.

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-US', opts);
const pct1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const pct0 = nf({ style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });

export function fmtPct(x: number | undefined | null, digits: 0 | 1 = 1): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return '—';
  if (digits === 1 && Math.abs(x) >= 10) return pct0.format(x); // +1,234% is noise at one decimal
  return (digits === 0 ? pct0 : pct1).format(x).replace('-', '−');
}

export function dirClass(x: number | undefined | null): 'up' | 'down' | 'flat' {
  if (x === undefined || x === null || !Number.isFinite(x) || Math.abs(x) < 0.0005) return 'flat';
  return x > 0 ? 'up' : 'down';
}

const CCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', HKD: 'HK$', TWD: 'NT$', KRW: '₩', CHF: 'CHF ', DKK: 'DKK ',
  AUD: 'A$', CAD: 'C$', SEK: 'SEK ',
};

export function fmtPrice(x: number | undefined | null, ccy?: string): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return '—';
  const sym = ccy ? CCY_SYMBOL[ccy.toUpperCase()] ?? `${ccy.toUpperCase()} ` : '';
  const abs = Math.abs(x);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return `${sym}${nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x)}`;
}

/** Compact money in a currency: $1.23T, $845B, ₩1,095T. */
export function fmtCompact(x: number | undefined | null, ccy = 'USD'): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return '—';
  const sym = CCY_SYMBOL[ccy.toUpperCase()] ?? `${ccy.toUpperCase()} `;
  const abs = Math.abs(x);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [v, u] of units) {
    if (abs >= v) {
      const n = x / v;
      const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
      return `${sym}${n.toFixed(digits)}${u}`;
    }
  }
  return `${sym}${x.toFixed(0)}`;
}

export function fmtMultiple(x: number | undefined | null): string {
  if (x === undefined || x === null || !Number.isFinite(x) || x <= 0) return '—';
  return `${x >= 100 ? x.toFixed(0) : x.toFixed(1)}×`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 9, 2026" from an ISO date or datetime (calendar date, no timezone shift). */
export function fmtDate(iso: string | undefined | null, withYear = true): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return withYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

export function fmtMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Oct 9, 2026, 5:41 PM ET" for timestamps, in the site timezone. */
export function fmtDateTime(iso: string | undefined | null, timeZone = 'America/New_York'): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt);
  const tz = timeZone === 'America/New_York' ? 'ET' : timeZone;
  return `${s} ${tz}`;
}

export function relativeDays(iso: string, today = new Date().toISOString().slice(0, 10)): string {
  const days = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return days < 45 ? `in ${days} days` : `in ${Math.round(days / 30)} months`;
  return -days < 45 ? `${-days} days ago` : `${Math.round(-days / 30)} months ago`;
}

export function todayISO(timeZone = 'America/New_York'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export const DIRECTION_LABEL = { long: 'Long', short: 'Short', neutral: 'Neutral', watch: 'Watching' } as const;
export const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  'target-hit': 'Target hit',
  stopped: 'Stopped out',
  invalidated: 'Invalidated',
  expired: 'Expired',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
};
export const POSITION_LABEL = { upstream: 'Upstream', midstream: 'Midstream', downstream: 'Downstream' } as const;
export const TIER_LABEL = { core: 'Core', focus: 'Focus', watch: 'Watchlist' } as const;
export const LAYER_CODE: Record<string, string> = { energy: 'L1', chips: 'L2', infrastructure: 'L3', models: 'L4', applications: 'L5' };

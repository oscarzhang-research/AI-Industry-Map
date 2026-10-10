import type { AnyRecord } from '../lib/types.ts';

/** Drop undefined, null, empty strings, empty arrays and empty objects, recursively (keeps 0 and false). */
export function prune<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => prune(v)).filter((v) => !isEmpty(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = prune(v);
      if (!isEmpty(p)) out[k] = p;
    }
    return out as T;
  }
  if (typeof value === 'string') return value.replace(/\s+$/, '') as unknown as T;
  return value;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** `base`, or `base-2`, `base-3`… if a record with that id exists. */
export function uniqueId(base: string, records: AnyRecord[]): string {
  const ids = new Set(records.map((r) => r.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Monday..Sunday of the week containing `iso`, and other period helpers for the journal. */
export function periodFor(kind: 'week' | 'fortnight' | 'month' | 'quarter', iso: string): { start: string; end: string } {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  if (kind === 'week' || kind === 'fortnight') {
    const dow = (d.getUTCDay() + 6) % 7;
    const end = new Date(d);
    end.setUTCDate(d.getUTCDate() - dow + 6);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (kind === 'week' ? 6 : 13));
    return { start: fmt(start), end: fmt(end) };
  }
  if (kind === 'month') {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { start: fmt(start), end: fmt(end) };
  }
  const q = Math.floor(d.getUTCMonth() / 3);
  return { start: fmt(new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1))), end: fmt(new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0))) };
}

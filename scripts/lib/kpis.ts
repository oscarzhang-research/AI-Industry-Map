// Compiles content/kpis.yaml and data/kpis/ into the indicator series the site charts (generated/kpis.json),
// plus per-listing reported figures for the company pages. Pure apart from the file reads in loadKpiData().
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Company, Financials, Kpi, KpiRangePoint, LayerId } from '../../src/lib/types.ts';
import { marketOf } from '../../src/lib/symbols.ts';
import type { Issue } from './load.ts';

/** A fact from SEC company facts: a period's value, already split into quarters by the fetcher. */
export interface SecFact {
  start: string;
  end: string;
  value: number;
  filed?: string;
  form?: string;
  derived?: boolean;
}

export interface SecFile {
  symbol: string;
  updatedAt?: string;
  revenue?: SecFact[];
  capex?: SecFact[];
}

export interface TwMonth {
  month: string; // YYYY-MM
  revenue: number; // NT$
  yoy?: number; // fraction
}

export interface KpiDef {
  id: string;
  name: string;
  layer: LayerId;
  nodes?: string[];
  kind: Kpi['kind'];
  metric?: 'revenue' | 'capex';
  frequency?: 'month' | 'quarter';
  company?: string;
  companies?: string[];
  description: string;
  note?: string;
  unit?: string;
  series?: { id: string; label: string; points: (KpiRangePoint & { published?: string | Date })[] }[];
}

export interface KpiDoc {
  sec?: string[];
  indicators?: KpiDef[];
}

const DAY = 86400000;
const SEC_SOURCE = { name: 'SEC filings (XBRL company facts)', url: 'https://www.sec.gov/edgar/search/' };
const TW_SOURCE = { name: 'TWSE and TPEx monthly revenue reports', url: 'https://mops.twse.com.tw/' };
const QUARTERS_SHOWN = 12;
const MONTHS_SHOWN = 37;
const GROWTH_QUARTERS = 8;
const GROWTH_MONTHS = 12;

/** Calendar quarter ('2026Q3') holding most of a fiscal period: the one its midpoint falls in. */
export function calendarQuarter(start: string, end: string): string {
  const mid = new Date((Date.parse(start) + Date.parse(end)) / 2);
  return `${mid.getUTCFullYear()}Q${Math.floor(mid.getUTCMonth() / 3) + 1}`;
}

export function shiftQuarter(q: string, n: number): string {
  const y = Number(q.slice(0, 4));
  const k = Number(q.slice(5)) - 1 + n;
  return `${y + Math.floor(k / 4)}Q${(((k % 4) + 4) % 4) + 1}`;
}

export function shiftMonth(m: string, n: number): string {
  const y = Number(m.slice(0, 4));
  const k = Number(m.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(k / 12)}-${String((((k % 12) + 12) % 12) + 1).padStart(2, '0')}`;
}

/** Quarterly values by calendar quarter. Periods of 70-105 days only; the latest filing wins. */
export function byQuarter(facts: SecFact[] | undefined): Map<string, { value: number; end: string }> {
  const out = new Map<string, { value: number; end: string; filed: string }>();
  for (const f of facts ?? []) {
    if (!f.start || !f.end || !Number.isFinite(f.value)) continue;
    const days = (Date.parse(f.end) - Date.parse(f.start)) / DAY;
    if (days < 70 || days > 105) continue;
    const q = calendarQuarter(f.start, f.end);
    const prev = out.get(q);
    if (!prev || (f.filed ?? '') > prev.filed || ((f.filed ?? '') === prev.filed && f.end > prev.end)) out.set(q, { value: f.value, end: f.end, filed: f.filed ?? '' });
  }
  return new Map([...out].map(([q, v]) => [q, { value: v.value, end: v.end }]));
}

/** Parse data/kpis/tw/<code>.csv (month,revenue,yoy,mom; revenue in NT$ thousand, growth in percent). */
export function parseTwCsv(text: string): TwMonth[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const col = new Map(lines[0].split(',').map((h, i) => [h.trim(), i]));
  const out: TwMonth[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const month = (cells[col.get('month') ?? 0] ?? '').trim().slice(0, 7);
    const rev = Number(cells[col.get('revenue') ?? 1]);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(rev) || rev <= 0) continue;
    const yi = col.get('yoy');
    const yoy = yi !== undefined && cells[yi] !== '' && cells[yi] !== undefined ? Number(cells[yi]) : NaN;
    out.push({ month, revenue: rev * 1000, yoy: Number.isFinite(yoy) ? yoy / 100 : undefined });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** The listing whose filings or monthly reports describe a company. */
export function usSymbol(c: Company | undefined): string | undefined {
  return c?.tickers.find((t) => marketOf(t.symbol) === 'US')?.symbol;
}
export function twCode(c: Company | undefined): string | undefined {
  const t = c?.tickers.find((x) => /\.TWO?$/.test(x.symbol));
  return t?.symbol.replace(/\.TWO?$/, '');
}

export interface KpiData {
  sec: Map<string, SecFile>; // by symbol
  tw: Map<string, TwMonth[]>; // by code (2330)
  updatedAt: string | null;
}

export function loadKpiData(dataDir: string): KpiData {
  const sec = new Map<string, SecFile>();
  const tw = new Map<string, TwMonth[]>();
  const secDir = join(dataDir, 'kpis', 'sec');
  if (existsSync(secDir)) {
    for (const f of readdirSync(secDir).filter((x) => x.endsWith('.json'))) {
      try {
        const doc = JSON.parse(readFileSync(join(secDir, f), 'utf8')) as SecFile;
        if (doc?.symbol) sec.set(doc.symbol, doc);
      } catch {
        // a broken file only drops that company
      }
    }
  }
  const twDir = join(dataDir, 'kpis', 'tw');
  if (existsSync(twDir)) {
    for (const f of readdirSync(twDir).filter((x) => x.endsWith('.csv'))) {
      const rows = parseTwCsv(readFileSync(join(twDir, f), 'utf8'));
      if (rows.length) tw.set(f.slice(0, -4).replace(/\.TWO?$/, ''), rows);
    }
  }
  let updatedAt: string | null = null;
  try {
    updatedAt = (JSON.parse(readFileSync(join(dataDir, 'kpis', 'status.json'), 'utf8')) as { updatedAt?: string }).updatedAt ?? null;
  } catch {
    updatedAt = null;
  }
  return { sec, tw, updatedAt };
}

const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : undefined);

export function validateKpis(doc: KpiDoc | undefined, companies: Record<string, Company>, nodes: Map<string, unknown>, issues: Issue[]) {
  const file = 'content/kpis.yaml';
  const ids = new Set<string>();
  for (const k of doc?.indicators ?? []) {
    if (!k.id || ids.has(k.id)) issues.push({ level: 'error', file, msg: `missing or duplicate indicator id ${k.id}` });
    ids.add(k.id);
    if (!['stack', 'monthly', 'growth-table', 'ranges', 'valuations'].includes(k.kind)) issues.push({ level: 'error', file, msg: `${k.id}: unknown kind ${k.kind}` });
    if (!nodes.has(k.layer)) issues.push({ level: 'error', file, msg: `${k.id}: unknown layer ${k.layer}` });
    for (const n of k.nodes ?? []) if (!nodes.has(n)) issues.push({ level: 'warn', file, msg: `${k.id}: unknown node ${n}` });
    for (const c of [...(k.companies ?? []), ...(k.company ? [k.company] : [])]) {
      const co = companies[c];
      if (!co) issues.push({ level: 'warn', file, msg: `${k.id}: unknown company ${c}` });
      else if (k.kind === 'monthly' || (k.kind === 'growth-table' && k.frequency === 'month')) {
        if (!twCode(co)) issues.push({ level: 'warn', file, msg: `${k.id}: ${c} has no Taiwan listing` });
      } else if ((k.kind === 'stack' || k.kind === 'growth-table') && !usSymbol(co)) issues.push({ level: 'warn', file, msg: `${k.id}: ${c} has no US listing` });
      else if ((k.kind === 'stack' || k.kind === 'growth-table') && doc?.sec && !doc.sec.includes(usSymbol(co)!)) {
        issues.push({ level: 'warn', file, msg: `${k.id}: ${usSymbol(co)} is not in the sec list, so no filings are fetched` });
      }
    }
    for (const s of k.series ?? [])
      for (const p of s.points ?? []) {
        if (!/^[1-4]Q\d{2}$/.test(String(p.period))) issues.push({ level: 'warn', file, msg: `${k.id}/${s.id}: period ${p.period} is not like 1Q26` });
        if (!(p.low <= p.high)) issues.push({ level: 'warn', file, msg: `${k.id}/${s.id} ${p.period}: low above high` });
        if (!p.url) issues.push({ level: 'warn', file, msg: `${k.id}/${s.id} ${p.period}: no source url` });
      }
  }
}

const nameOf = (companies: Record<string, Company>, id: string) => companies[id]?.name ?? id;
const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]);

/** Build every indicator that has data. Indicators without any data are left out. */
export function compileKpis(doc: KpiDoc | undefined, companies: Record<string, Company>, data: KpiData): Kpi[] {
  const out: Kpi[] = [];
  for (const k of doc?.indicators ?? []) {
    const base = { id: k.id, name: k.name, layer: k.layer, nodes: k.nodes, description: k.description.trim(), note: k.note?.trim(), unit: k.unit };
    if (k.kind === 'stack' && k.metric) {
      const members = (k.companies ?? []).map((id) => ({ id, q: byQuarter(data.sec.get(usSymbol(companies[id]) ?? '')?.[k.metric!]) }));
      const all = [...new Set(members.flatMap((m) => [...m.q.keys()]))].sort();
      if (!all.length) continue;
      const periods = all.slice(-QUARTERS_SHOWN);
      const listed = members.map((m) => ({ company: m.id, label: nameOf(companies, m.id), values: periods.map((p) => m.q.get(p)?.value ?? null) }));
      // A company with no figures at all (NextEra tags its capex only with its own XBRL concepts, which
      // the SEC's company facts leave out) is named in the note instead of leaving every quarter incomplete.
      const parts = listed.filter((p) => p.values.some((v) => v !== null));
      const missing = listed.filter((p) => !parts.includes(p)).map((p) => p.label);
      const note = [base.note, missing.length ? `${joinNames(missing)} not included: the SEC's standardized data has no figures for ${missing.length > 1 ? 'them' : 'it'}.` : '']
        .filter(Boolean)
        .join(' ') || undefined;
      const complete = periods.map((_, i) => parts.every((p) => p.values[i] !== null));
      const total = periods.map((_, i) => (parts.some((p) => p.values[i] !== null) ? parts.reduce((a, p) => a + (p.values[i] ?? 0), 0) : null));
      out.push({ ...base, note, kind: 'stack', metric: k.metric, unit: k.unit ?? 'USD', periods, parts, total, complete, sources: [SEC_SOURCE], asOf: periods[periods.length - 1] });
    } else if (k.kind === 'monthly' && k.company) {
      const rows = data.tw.get(twCode(companies[k.company]) ?? '');
      if (!rows?.length) continue;
      const shown = rows.slice(-MONTHS_SHOWN);
      const byMonth = new Map(rows.map((r) => [r.month, r.revenue]));
      const yoy = shown.map((r) => r.yoy ?? (byMonth.get(shiftMonth(r.month, -12)) ? r.revenue / byMonth.get(shiftMonth(r.month, -12))! - 1 : null));
      out.push({ ...base, kind: 'monthly', company: k.company, unit: k.unit ?? 'TWD', months: shown.map((r) => r.month), values: shown.map((r) => r.revenue), yoy, sources: [TW_SOURCE], asOf: shown[shown.length - 1].month });
    } else if (k.kind === 'growth-table' && k.frequency === 'month') {
      const series = (k.companies ?? []).map((id) => ({ id, rows: data.tw.get(twCode(companies[id]) ?? '') ?? [] }));
      const latest = series.flatMap((s) => s.rows.map((r) => r.month)).sort().pop();
      if (!latest) continue;
      const periods = Array.from({ length: GROWTH_MONTHS }, (_, i) => shiftMonth(latest, i - GROWTH_MONTHS + 1));
      const rows = series.map((s) => {
        const m = new Map(s.rows.map((r) => [r.month, r]));
        return {
          company: s.id,
          label: nameOf(companies, s.id),
          values: periods.map((p) => {
            const r = m.get(p);
            if (!r) return null;
            if (r.yoy !== undefined) return r.yoy;
            const prev = m.get(shiftMonth(p, -12));
            return prev ? r.revenue / prev.revenue - 1 : null;
          }),
        };
      });
      out.push({ ...base, kind: 'growth-table', frequency: 'month', periods, rows, sources: [TW_SOURCE], asOf: latest });
    } else if (k.kind === 'growth-table' && k.metric) {
      const series = (k.companies ?? []).map((id) => ({ id, q: byQuarter(data.sec.get(usSymbol(companies[id]) ?? '')?.[k.metric!]) }));
      const latest = series.flatMap((s) => [...s.q.keys()]).sort().pop();
      if (!latest) continue;
      const periods = Array.from({ length: GROWTH_QUARTERS }, (_, i) => shiftQuarter(latest, i - GROWTH_QUARTERS + 1));
      const rows = series.map((s) => ({
        company: s.id,
        label: nameOf(companies, s.id),
        values: periods.map((p) => {
          const now = s.q.get(p)?.value;
          const then = s.q.get(shiftQuarter(p, -4))?.value;
          return now !== undefined && then ? now / then - 1 : null;
        }),
      }));
      out.push({ ...base, kind: 'growth-table', frequency: 'quarter', periods, rows, sources: [SEC_SOURCE], asOf: latest });
    } else if (k.kind === 'ranges') {
      const series = (k.series ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        points: (s.points ?? []).map((p) => ({ ...p, period: String(p.period), published: isoDay(p.published) })).sort((a, b) => quarterKey(a.period).localeCompare(quarterKey(b.period))),
      }));
      const sources = [...new Map(series.flatMap((s) => s.points).filter((p) => p.url).map((p) => [p.url!, { name: `TrendForce, ${p.published ?? ''}`.replace(/, $/, ''), url: p.url }])).values()];
      out.push({ ...base, kind: 'ranges', series, sources: sources.length ? sources : [{ name: 'TrendForce' }], asOf: series.flatMap((s) => s.points.map((p) => p.published ?? '')).sort().pop() });
    } else if (k.kind === 'valuations') {
      const items = (k.companies ?? [])
        .map((id) => ({ id, v: companies[id]?.private?.valuation }))
        .filter((x) => x.v?.usd)
        .map((x) => ({ company: x.id, label: nameOf(companies, x.id), usd: x.v!.usd!, date: x.v!.date ? String(x.v!.date).slice(0, 7) : undefined, round: x.v!.round }))
        .sort((a, b) => b.usd - a.usd);
      if (!items.length) continue;
      out.push({ ...base, kind: 'valuations', unit: 'USD', items, sources: [{ name: 'Company pages on this site, from funding announcements and press reports' }], asOf: items.map((i) => i.date ?? '').sort().pop() });
    }
  }
  return out;
}

/** '1Q26' sorts as '2026-1'. */
function quarterKey(p: string): string {
  const m = /^([1-4])Q(\d{2})$/.exec(p);
  return m ? `20${m[2]}-${m[1]}` : p;
}

/** Reported revenue and capex for a company page (the same figures for each of its listings). */
export function financialsFor(company: Company, data: KpiData): Financials | undefined {
  const fin: Financials = {};
  const us = usSymbol(company);
  const sec = us ? data.sec.get(us) : undefined;
  if (sec) {
    const rev = byQuarter(sec.revenue);
    const cap = byQuarter(sec.capex);
    const periods = [...new Set([...rev.keys(), ...cap.keys()])].sort().slice(-QUARTERS_SHOWN);
    if (periods.length) {
      fin.ccy = 'USD';
      fin.quarters = periods.map((p) => ({ period: p, end: (rev.get(p) ?? cap.get(p))!.end, revenue: rev.get(p)?.value, capex: cap.get(p)?.value }));
    }
  }
  const code = twCode(company);
  const tw = code ? data.tw.get(code) : undefined;
  if (tw?.length && !fin.quarters) {
    fin.ccy = 'TWD';
    fin.months = tw.slice(-MONTHS_SHOWN).map((r) => ({ month: r.month, revenue: r.revenue, yoy: r.yoy }));
  }
  return fin.quarters || fin.months ? fin : undefined;
}

export function readKpiDoc(path: string): KpiDoc | undefined {
  if (!existsSync(path)) return undefined;
  return parseYaml(readFileSync(path, 'utf8')) as KpiDoc;
}

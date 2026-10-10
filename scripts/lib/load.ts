// Loads and cross-links all content files. Shared by build-data.ts and validate.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  AnyRecord, Benchmark, Company, Ecosystem, EventItem, Industry, Layer, LayerId, NewsItem, ReportMeta,
  Segment, SiteConfig, Theme,
} from '../../src/lib/types.ts';
import { LAYER_IDS } from '../../src/lib/types.ts';
import { marketOf } from '../../src/lib/symbols.ts';
import { parseRecordFile } from '../../src/lib/records.ts';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

export interface Issue {
  level: 'error' | 'warn';
  file: string;
  msg: string;
}

export interface Content {
  config: SiteConfig;
  layers: Layer[];
  companies: Record<string, Company>;
  themes: Theme[];
  ecosystems: Ecosystem[];
  benchmarks: Benchmark[];
  benchmarkDefaults: Record<string, string>;
  extraSymbols: string[];
  events: EventItem[];
  news: NewsItem[];
  reports: (ReportMeta & { dir: string })[];
  records: AnyRecord[];
  nodes: Map<string, { kind: 'layer' | 'industry' | 'segment'; name: string }>;
  issues: Issue[];
}

function readYaml<T>(path: string, issues: Issue[], required = true): T | undefined {
  if (!existsSync(path)) {
    if (required) issues.push({ level: 'error', file: rel(path), msg: 'missing file' });
    return undefined;
  }
  try {
    return parseYaml(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    issues.push({ level: 'error', file: rel(path), msg: `YAML error: ${(e as Error).message.split('\n')[0]}` });
    return undefined;
  }
}

const rel = (p: string) => relative(ROOT, p);

function asDate(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function loadContent(): Content {
  const issues: Issue[] = [];
  const config = readYaml<SiteConfig>(join(ROOT, 'site.config.yaml'), issues)!;

  // ---- Taxonomy -----------------------------------------------------------
  const layerDoc = readYaml<{ layers: Omit<Layer, 'industries'>[] }>(join(ROOT, 'content/taxonomy/layers.yaml'), issues);
  const layers: Layer[] = [];
  const nodes = new Map<string, { kind: 'layer' | 'industry' | 'segment'; name: string }>();
  const membership = new Map<string, string[]>(); // company -> segment paths
  for (const l of layerDoc?.layers ?? []) {
    const file = join(ROOT, `content/taxonomy/${l.id}.yaml`);
    const doc = readYaml<{ layer: string; industries: Industry[] }>(file, issues);
    const industries: Industry[] = [];
    nodes.set(l.id, { kind: 'layer', name: l.name });
    for (const ind of doc?.industries ?? []) {
      const ipath = `${l.id}/${ind.id}`;
      if (nodes.has(ipath)) issues.push({ level: 'error', file: rel(file), msg: `duplicate industry ${ipath}` });
      nodes.set(ipath, { kind: 'industry', name: ind.name });
      const segments: Segment[] = [];
      for (const seg of ind.segments ?? []) {
        const spath = `${ipath}/${seg.id}`;
        if (nodes.has(spath)) issues.push({ level: 'error', file: rel(file), msg: `duplicate segment ${spath}` });
        nodes.set(spath, { kind: 'segment', name: seg.name });
        const companies = (seg.companies ?? []).map(String);
        for (const c of companies) membership.set(c, [...(membership.get(c) ?? []), spath]);
        segments.push({ ...seg, path: spath, companies, position: seg.position ?? 'midstream' });
      }
      industries.push({ ...ind, path: ipath, layer: l.id as LayerId, segments });
    }
    layers.push({ ...l, watch: l.watch ?? [], featured: l.featured ?? [], industries });
  }
  layers.sort((a, b) => a.order - b.order);
  for (const id of LAYER_IDS) if (!layers.find((l) => l.id === id)) issues.push({ level: 'error', file: 'content/taxonomy/layers.yaml', msg: `layer ${id} missing` });

  // Segment refs must point at real nodes
  for (const l of layers)
    for (const ind of l.industries)
      for (const seg of ind.segments)
        if (seg.ref && !nodes.has(seg.ref))
          issues.push({ level: 'error', file: `content/taxonomy/${l.id}.yaml`, msg: `${seg.path} refs unknown node ${seg.ref}` });

  // ---- Companies ------------------------------------------------------------
  const companies: Record<string, Company> = {};
  const companyDir = join(ROOT, 'content/companies');
  for (const f of existsSync(companyDir) ? readdirSync(companyDir).filter((x) => x.endsWith('.yaml')).sort() : []) {
    const path = join(companyDir, f);
    const doc = readYaml<{ companies: Record<string, Partial<Company>> }>(path, issues);
    for (const [id, raw] of Object.entries(doc?.companies ?? {})) {
      if (companies[id]) {
        issues.push({ level: 'error', file: rel(path), msg: `duplicate company id ${id}` });
        continue;
      }
      const c = raw as Company;
      const tickers = (c.tickers ?? []).filter((t) => t && t.symbol);
      const placements = membership.get(id) ?? [];
      const primary = c.primary && nodes.has(c.primary) ? c.primary : placements[0];
      if (!c.primary || !nodes.has(c.primary)) issues.push({ level: 'warn', file: rel(path), msg: `${id}: primary "${c.primary}" not a node; using ${primary}` });
      if (primary && !placements.includes(primary) && nodes.get(primary)?.kind === 'segment')
        issues.push({ level: 'warn', file: rel(path), msg: `${id}: primary ${primary} is not one of its placements` });
      const layersOf = [...new Set(placements.map((p) => p.split('/')[0] as LayerId))];
      const listing = c.listing ?? (tickers.length ? 'listed' : 'private');
      if (listing === 'listed' && !tickers.length) issues.push({ level: 'warn', file: rel(path), msg: `${id}: listed but no ticker yet (no price series)` });
      companies[id] = {
        ...c,
        id,
        name: c.name || id,
        listing,
        tickers,
        tier: c.tier ?? 'watch',
        primary: primary ?? '',
        placements,
        layers: layersOf,
        primaryLayer: ((primary ?? '').split('/')[0] || layersOf[0] || 'chips') as LayerId,
        symbol: listing === 'listed' ? tickers[0]?.symbol : undefined,
        market: listing === 'listed' ? marketOf(tickers[0]?.symbol) : undefined,
      };
    }
  }
  for (const [id, segs] of membership) {
    if (!companies[id]) {
      issues.push({ level: 'warn', file: 'content/companies', msg: `no record for ${id} (in ${segs[0]}); using a placeholder` });
      const layer = segs[0].split('/')[0] as LayerId;
      companies[id] = {
        id, name: id, listing: 'private', tickers: [], tier: 'watch', primary: segs[0], placements: segs,
        layers: [...new Set(segs.map((p) => p.split('/')[0] as LayerId))], primaryLayer: layer,
      };
    }
  }
  for (const c of Object.values(companies))
    if (!c.placements.length) issues.push({ level: 'warn', file: 'content/companies', msg: `${c.id} is not placed in any segment` });
  for (const l of layers)
    for (const f of l.featured) {
      if (!companies[f]) issues.push({ level: 'error', file: 'content/taxonomy/layers.yaml', msg: `featured ${f} unknown` });
      else if (!companies[f].layers.includes(l.id)) issues.push({ level: 'warn', file: 'content/taxonomy/layers.yaml', msg: `featured ${f} not placed in ${l.id}` });
    }

  // ---- Themes, ecosystems, benchmarks, events --------------------------------
  const themes = readYaml<{ themes: Theme[] }>(join(ROOT, 'content/themes.yaml'), issues)?.themes ?? [];
  for (const t of themes) for (const c of t.companies ?? []) if (!companies[c]) issues.push({ level: 'warn', file: 'content/themes.yaml', msg: `${t.id}: unknown company ${c}` });
  const ecosystems = readYaml<{ ecosystems: Ecosystem[] }>(join(ROOT, 'content/ecosystems.yaml'), issues)?.ecosystems ?? [];
  const ecoIds = new Set(ecosystems.map((e) => e.id));
  for (const c of Object.values(companies))
    for (const e of c.ecosystems ?? []) if (!ecoIds.has(e)) issues.push({ level: 'warn', file: 'content/companies', msg: `${c.id}: unknown ecosystem ${e}` });
  const bdoc = readYaml<{ benchmarks: Benchmark[]; defaults: Record<string, string>; extraSymbols?: string[] }>(join(ROOT, 'content/benchmarks.yaml'), issues);
  const eventsDoc = readYaml<{ events: EventItem[] }>(join(ROOT, 'content/events.yaml'), issues, false);
  const events = (eventsDoc?.events ?? []).map((e) => ({ ...e, start: asDate(e.start)!, end: asDate(e.end) }));
  for (const e of events) {
    for (const c of e.companies ?? []) if (!companies[c]) issues.push({ level: 'warn', file: 'content/events.yaml', msg: `${e.id}: unknown company ${c}` });
    for (const n of e.nodes ?? []) if (!nodes.has(n)) issues.push({ level: 'warn', file: 'content/events.yaml', msg: `${e.id}: unknown node ${n}` });
  }

  // ---- News -------------------------------------------------------------------
  const news: NewsItem[] = [];
  const newsDir = join(ROOT, 'content/news');
  const newsIds = new Set<string>();
  const themeIds = new Set(themes.map((t) => t.id));
  for (const f of existsSync(newsDir) ? readdirSync(newsDir).filter((x) => x.endsWith('.yaml')).sort() : []) {
    const path = join(newsDir, f);
    const doc = readYaml<{ items: NewsItem[] }>(path, issues);
    for (const raw of doc?.items ?? []) {
      const it = { ...raw, date: asDate(raw.date)!, companies: raw.companies ?? [], nodes: raw.nodes ?? [] };
      if (newsIds.has(it.id)) {
        issues.push({ level: 'warn', file: rel(path), msg: `duplicate news id ${it.id}` });
        continue;
      }
      newsIds.add(it.id);
      it.companies = it.companies.filter((c) => {
        if (companies[c]) return true;
        issues.push({ level: 'warn', file: rel(path), msg: `${it.id}: unknown company ${c}` });
        return false;
      });
      it.nodes = it.nodes.filter((n) => {
        if (nodes.has(n)) return true;
        issues.push({ level: 'warn', file: rel(path), msg: `${it.id}: unknown node ${n}` });
        return false;
      });
      for (const t of it.themes ?? []) if (!themeIds.has(t)) issues.push({ level: 'warn', file: rel(path), msg: `${it.id}: unknown theme ${t}` });
      news.push(it);
    }
  }
  news.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.importance ?? 1) - (a.importance ?? 1)));

  // ---- Reports (public Claude research) ----------------------------------------
  const reports: (ReportMeta & { dir: string })[] = [];
  const repDir = join(ROOT, 'content/reports');
  for (const d of existsSync(repDir) ? readdirSync(repDir).sort() : []) {
    const dir = join(repDir, d);
    if (!statSync(dir).isDirectory()) continue;
    const metaPath = join(dir, 'meta.yaml');
    const meta = readYaml<ReportMeta>(metaPath, issues, false);
    if (!meta) {
      issues.push({ level: 'warn', file: rel(dir), msg: 'report without meta.yaml (skipped)' });
      continue;
    }
    const file = meta.file || 'report.html';
    if (!existsSync(join(dir, file))) {
      issues.push({ level: 'error', file: rel(metaPath), msg: `file ${file} missing` });
      continue;
    }
    const r: ReportMeta & { dir: string } = {
      ...meta,
      id: meta.id || d,
      kind: meta.kind || 'claude',
      visibility: meta.visibility || 'public',
      format: meta.format || 'html',
      file,
      date: asDate(meta.date)!,
      asOf: asDate(meta.asOf),
      companies: (meta.companies ?? []).filter((c) => !!companies[c] || (issues.push({ level: 'warn', file: rel(metaPath), msg: `unknown company ${c}` }), false)),
      nodes: (meta.nodes ?? []).filter((n) => nodes.has(n) || (issues.push({ level: 'warn', file: rel(metaPath), msg: `unknown node ${n}` }), false)),
      tags: meta.tags ?? [],
      size: statSync(join(dir, file)).size,
      dir,
    };
    if (r.id !== d) issues.push({ level: 'warn', file: rel(metaPath), msg: `id ${r.id} differs from folder ${d}` });
    if (r.visibility !== 'public') issues.push({ level: 'error', file: rel(metaPath), msg: 'non-public report in the public repo' });
    if (r.kind === 'sell-side') issues.push({ level: 'error', file: rel(metaPath), msg: 'sell-side research must live in the private vault' });
    reports.push(r);
  }
  reports.sort((a, b) => (a.date < b.date ? 1 : -1));

  // ---- Records (public copies of theses, notes, journal, outlook) ---------------
  const records: AnyRecord[] = [];
  const viewsDir = join(ROOT, 'content/views');
  for (const sub of ['theses', 'notes', 'journal', 'outlook']) {
    const dir = join(viewsDir, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
      const path = join(dir, f);
      try {
        const rec = parseRecordFile(readFileSync(path, 'utf8'), rel(path));
        if (rec.visibility !== 'public') {
          issues.push({ level: 'error', file: rel(path), msg: 'private record in the public repo' });
          continue;
        }
        rec.origin = 'public';
        records.push(rec);
      } catch (e) {
        issues.push({ level: 'error', file: rel(path), msg: (e as Error).message });
      }
    }
  }
  for (const r of records) {
    if (r.type === 'thesis') {
      const s = r.subject;
      if (s?.kind === 'company' && s.company && !companies[s.company]) issues.push({ level: 'warn', file: r.path ?? r.id, msg: `unknown company ${s.company}` });
      if (s?.kind === 'node' && s.node && !nodes.has(s.node)) issues.push({ level: 'warn', file: r.path ?? r.id, msg: `unknown node ${s.node}` });
    }
  }

  return {
    config,
    layers,
    companies,
    themes,
    ecosystems,
    benchmarks: bdoc?.benchmarks ?? [],
    benchmarkDefaults: bdoc?.defaults ?? {},
    extraSymbols: bdoc?.extraSymbols ?? [],
    events,
    news,
    reports,
    records,
    nodes,
    issues,
  };
}

export function printIssues(issues: Issue[], quiet = false): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  if (!quiet || errors.length) {
    for (const i of issues) console[i.level === 'error' ? 'error' : 'warn'](`${i.level === 'error' ? 'ERROR' : 'warn '} ${i.file}: ${i.msg}`);
  }
  return { errors: errors.length, warnings: warnings.length };
}

import MiniSearch from 'minisearch';
import type { AnyRecord, NewsItem, ReportMeta, SiteData, ThesisRecord } from './types.ts';
import { excerpt } from './markdown.ts';
import { industryLink } from './nodes.ts';

export interface SearchDoc {
  id: string;
  kind: 'company' | 'layer' | 'industry' | 'segment' | 'thesis' | 'note' | 'journal' | 'report' | 'news' | 'theme';
  title: string;
  sub?: string;
  href: string;
  text: string;
}

/** Split Latin words normally and CJK runs into overlapping bigrams, so Chinese queries match. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}.\-^]*/gu)) {
    const tok = m[0];
    if (/\p{Script=Han}/u.test(tok)) {
      if (tok.length === 1) out.push(tok);
      for (let i = 0; i < tok.length - 1; i++) out.push(tok.slice(i, i + 2));
    } else {
      out.push(tok);
      if (tok.includes('.')) out.push(...tok.split('.').filter(Boolean));
    }
  }
  return out;
}

export function buildDocs(site: SiteData, records: AnyRecord[], reports: ReportMeta[], news: NewsItem[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const c of Object.values(site.companies)) {
    docs.push({
      id: `c:${c.id}`,
      kind: 'company',
      title: c.name,
      sub: [c.tickers.map((t) => t.symbol).join(' · '), c.nameZh].filter(Boolean).join(' · '),
      href: `/company/${c.id}`,
      text: [c.name, c.nameZh, ...(c.aliases ?? []), ...c.tickers.map((t) => t.symbol), c.description].filter(Boolean).join(' '),
    });
  }
  for (const l of site.layers) {
    docs.push({ id: `l:${l.id}`, kind: 'layer', title: `${l.name} layer`, sub: l.nameZh, href: `/layer/${l.id}`, text: `${l.name} ${l.nameZh ?? ''} ${l.tagline} ${l.description}` });
    for (const ind of l.industries) {
      docs.push({ id: `i:${ind.path}`, kind: 'industry', title: ind.name, sub: `${l.name}${ind.nameZh ? ` · ${ind.nameZh}` : ''}`, href: industryLink(ind.path), text: `${ind.name} ${ind.nameZh ?? ''} ${ind.description ?? ''}` });
      for (const s of ind.segments) {
        if (s.ref) continue;
        docs.push({ id: `s:${s.path}`, kind: 'segment', title: s.name, sub: `${ind.name}${s.nameZh ? ` · ${s.nameZh}` : ''}`, href: industryLink(s.path), text: `${s.name} ${s.nameZh ?? ''}` });
      }
    }
  }
  for (const t of site.themes) docs.push({ id: `t:${t.id}`, kind: 'theme', title: t.name, sub: t.nameZh, href: `/theme/${t.id}`, text: `${t.name} ${t.nameZh ?? ''} ${t.description ?? ''}` });
  for (const r of records) {
    if (r.type === 'outlook') continue;
    const title = r.type === 'thesis' ? (r as ThesisRecord).title || (r as ThesisRecord).summary : r.title || excerpt(r.body, 80);
    const href = r.type === 'thesis' ? `/thesis/${r.id}` : r.type === 'journal' ? `/journal#${r.id}` : `/notes#${r.id}`;
    const text = [r.title, r.type === 'thesis' ? (r as ThesisRecord).summary : '', (r as ThesisRecord).logic, r.body, ...(r.tags ?? []), ...Object.values(r.translation?.fields ?? {})].filter(Boolean).join(' ');
    docs.push({ id: `r:${r.id}`, kind: r.type, title: title || r.id, sub: r.createdAt.slice(0, 10), href, text });
  }
  for (const r of reports) {
    docs.push({
      id: `p:${r.id}`,
      kind: 'report',
      title: r.title,
      sub: [r.date, r.broker || (r.kind === 'claude' ? 'Claude research' : ''), r.titleZh].filter(Boolean).join(' · '),
      href: `/report/${r.id}`,
      text: [r.title, r.titleZh, r.subtitle, ...(r.summary?.en ?? []), ...(r.summary?.zh ?? []), ...(r.tags ?? []), r.broker].filter(Boolean).join(' '),
    });
  }
  for (const n of news.slice(0, 400)) docs.push({ id: `n:${n.id}`, kind: 'news', title: n.title, sub: `${n.date} · ${n.source?.name ?? ''}`, href: `/news#${n.id}`, text: `${n.title} ${n.summary ?? ''}` });
  return docs;
}

export function buildIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    fields: ['title', 'sub', 'text'],
    storeFields: ['id', 'kind', 'title', 'sub', 'href'],
    tokenize,
    processTerm: (t) => t.toLowerCase(),
    searchOptions: { boost: { title: 4, sub: 2 }, prefix: true, fuzzy: (term) => (term.length > 4 ? 0.15 : 0) },
  });
  ms.addAll(docs);
  return ms;
}

export function addReportText(ms: MiniSearch<SearchDoc>, docs: SearchDoc[], text: Record<string, string>): void {
  for (const d of docs) {
    if (d.kind !== 'report') continue;
    const body = text[d.id.slice(2)];
    if (!body) continue;
    ms.discard(d.id);
    ms.add({ ...d, text: `${d.text} ${body}` });
  }
}

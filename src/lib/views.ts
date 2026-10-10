// Helpers for theses and other records as the UI uses them.
import type { AnyRecord, Direction, JournalRecord, NoteRecord, OutlookRecord, SiteData, ThesisRecord } from './types.ts';
import { benchmarkIdFor } from './symbols.ts';
import { withTranslation } from './records.ts';

export const isThesis = (r: AnyRecord): r is ThesisRecord => r.type === 'thesis';
export const isNote = (r: AnyRecord): r is NoteRecord => r.type === 'note';
export const isJournal = (r: AnyRecord): r is JournalRecord => r.type === 'journal';
export const isOutlook = (r: AnyRecord): r is OutlookRecord => r.type === 'outlook';

export function theses(records: AnyRecord[], showExamples = true): ThesisRecord[] {
  return records.filter(isThesis).filter((t) => showExamples || !t.example);
}

export function activeTheses(records: AnyRecord[]): ThesisRecord[] {
  return theses(records).filter((t) => t.status === 'active');
}

/** Direction of the most recent active company thesis, per company (drives the ▲/▼ marks on the map). */
export function viewByCompany(records: AnyRecord[]): Map<string, Direction> {
  const out = new Map<string, Direction>();
  const sorted = activeTheses(records).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const t of sorted) {
    const id = t.subject?.company;
    if (id && !out.has(id)) out.set(id, t.direction);
  }
  return out;
}

export function thesisSymbol(t: ThesisRecord, site: SiteData): string | undefined {
  if (t.subject?.kind === 'company') {
    if (t.subject.symbol) return t.subject.symbol;
    const c = t.subject.company ? site.companies[t.subject.company] : undefined;
    return c?.symbol;
  }
  return t.subject?.proxy;
}

export function thesisBenchmark(t: ThesisRecord, site: SiteData): string | undefined {
  const byId = (id: string) => site.benchmarks.find((b) => b.id === id || b.symbol === id)?.symbol;
  if (t.benchmark) return byId(t.benchmark) ?? t.benchmark;
  const sym = thesisSymbol(t, site);
  const layer = t.subject?.company ? site.companies[t.subject.company]?.primaryLayer : t.subject?.node?.split('/')[0];
  return byId(benchmarkIdFor(sym, layer, site.benchmarkDefaults));
}

export function subjectLabel(t: ThesisRecord, site: SiteData, nodeName: (p: string) => string | undefined): string {
  const s = t.subject;
  if (!s) return 'Untitled';
  if (s.kind === 'company') return (s.company && site.companies[s.company]?.name) || s.company || 'Company';
  if (s.kind === 'node') return (s.node && nodeName(s.node)) || s.node || 'Industry';
  if (s.kind === 'theme') return site.themes.find((x) => x.id === s.theme)?.name || s.theme || 'Theme';
  return 'Subject';
}

export function latestOutlook(records: AnyRecord[]): OutlookRecord | undefined {
  return records.filter(isOutlook).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/** English display copy of a record (falls back to the original when no translation exists). */
export function display<T extends AnyRecord>(r: T, lang: 'en' | 'orig' = 'en'): T {
  return lang === 'en' ? withTranslation(r) : r;
}

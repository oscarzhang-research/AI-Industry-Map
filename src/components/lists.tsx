import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventItem, NewsItem, Quote, ReportMeta, SiteData, ThesisRecord } from '../lib/types.ts';
import { fmtDate, relativeDays, plural } from '../lib/format.ts';
import { CompanyChip, LayerBadge, PrivateBadge } from './ui.tsx';
import type { LayerId } from '../lib/types.ts';

export function NewsList({ items, site, onSaveNote, compact = false }: { items: NewsItem[]; site: SiteData; onSaveNote?: (n: NewsItem) => void; compact?: boolean }) {
  if (!items.length) return <div className="empty">No news tagged here yet.</div>;
  return (
    <div className="list">
      {items.map((n) => {
        const layer = (n.nodes[0]?.split('/')[0] || site.companies[n.companies[0]]?.primaryLayer) as LayerId | undefined;
        return (
          <article key={n.id} id={n.id} className={`list-item importance-${n.importance ?? 1}`}>
            <div className="when">{fmtDate(n.date, false)}</div>
            <div className="min0">
              <div className="title">
                {n.source?.url ? (
                  <a href={n.source.url} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
              </div>
              {!compact && n.summary ? <p className="summary">{n.summary}</p> : null}
              <div className="meta">
                {layer ? <LayerBadge layer={layer} /> : null}
                {n.source?.name ? <span>{n.source.name}</span> : null}
                {n.impact && n.impact !== 'neutral' ? (
                  <span className={n.impact === 'positive' ? 'up' : n.impact === 'negative' ? 'down' : 'ink2'}>
                    {n.impact === 'positive' ? '▲ Positive' : n.impact === 'negative' ? '▼ Negative' : '◆ Mixed'}
                  </span>
                ) : null}
                {!compact
                  ? n.companies.slice(0, 4).map((id) => {
                      const c = site.companies[id];
                      return c ? <CompanyChip key={id} company={c} withName={false} /> : null;
                    })
                  : null}
                {onSaveNote ? (
                  <button type="button" className="linkish" onClick={() => onSaveNote(n)}>
                    Save as note
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Report list that shows pinned + the most recent few and folds the rest. */
export function ReportList({ reports, site, shown = 5, emptyText = 'No research filed here yet.' }: { reports: ReportMeta[]; site: SiteData; shown?: number; emptyText?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'all' | 'claude' | 'sell-side'>('all');
  const filtered = reports.filter((r) => kind === 'all' || r.kind === kind);
  const pinned = filtered.filter((r) => r.pinned);
  const rest = filtered.filter((r) => !r.pinned);
  const visible = open ? [...pinned, ...rest] : [...pinned, ...rest.slice(0, shown)];
  const hidden = filtered.length - visible.length;
  const hasSellSide = reports.some((r) => r.kind === 'sell-side');
  if (!reports.length) return <div className="empty">{emptyText}</div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {hasSellSide ? (
        <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
          {(['all', 'claude', 'sell-side'] as const).map((k) => (
            <button key={k} type="button" className={`btn sm${kind === k ? ' primary' : ''}`} onClick={() => setKind(k)}>
              {k === 'all' ? `All ${reports.length}` : k === 'claude' ? 'Claude research' : 'Sell-side'}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ padding: '0 14px' }}>
        {visible.map((r) => (
          <ReportRow key={r.id} r={r} site={site} />
        ))}
      </div>
      {hidden > 0 || open ? (
        <div className="fold-toggle">
          <button type="button" className="btn sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Show fewer' : `Show all ${plural(filtered.length, 'report')} (${hidden} more)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReportRow({ r, site }: { r: ReportMeta; site: SiteData }) {
  return (
    <div className="report-row">
      <div className="when">{fmtDate(r.date)}</div>
      <div className="min0">
        <Link to={`/report/${encodeURIComponent(r.id)}`} className="rt">
          {r.title}
        </Link>
        <div className="row" style={{ marginTop: 4, gap: 6 }}>
          <span className="badge">{r.kind === 'claude' ? 'Claude research' : r.kind === 'sell-side' ? r.broker || 'Sell-side' : 'Other'}</span>
          {r.reportType ? <span className="badge">{r.reportType}</span> : null}
          {r.visibility === 'private' ? <PrivateBadge /> : null}
          {r.languages?.length === 1 && r.languages[0] === 'zh' ? <span className="badge">Chinese only</span> : null}
          {r.rating ? <span className="badge">{r.rating}</span> : null}
          {r.companies.slice(0, 3).map((id) => {
            const c = site.companies[id];
            return c ? <CompanyChip key={id} company={c} withName={false} /> : null;
          })}
        </div>
      </div>
      <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
        {r.titleZh && r.titleZh !== r.title ? r.titleZh : ''}
      </div>
    </div>
  );
}

export interface Catalyst {
  date: string;
  label: string;
  kind: string;
  href?: string;
  external?: boolean;
  tentative?: boolean;
  note?: string;
}

/** Upcoming earnings (from market data), industry events and thesis catalysts in one list. */
export function useCatalysts(site: SiteData, quotes: Record<string, Quote>, theses: ThesisRecord[], days = 45, companyFilter?: Set<string>): Catalyst[] {
  return useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const out: Catalyst[] = [];
    const seenEarn = new Set<string>();
    for (const e of site.events) {
      if (e.start < today || e.start > end) continue;
      if (companyFilter && !(e.companies ?? []).some((c) => companyFilter.has(c))) continue;
      if (e.kind === 'earnings') for (const c of e.companies ?? []) seenEarn.add(c);
      out.push({ date: e.start, label: e.name, kind: e.kind, href: e.url, external: !!e.url, tentative: e.tentative, note: e.note });
    }
    for (const c of Object.values(site.companies)) {
      if (c.listing !== 'listed' || !c.symbol || seenEarn.has(c.id)) continue;
      if (companyFilter ? !companyFilter.has(c.id) : c.tier !== 'core') continue;
      const q = quotes[c.symbol];
      if (!q?.earn || q.earn < today || q.earn > end) continue;
      out.push({ date: q.earn, label: `${c.name} earnings`, kind: 'earnings', href: `/company/${c.id}`, tentative: q.earnEst });
    }
    for (const t of theses) {
      for (const k of t.catalysts ?? []) {
        if (!k.date || k.date < today || k.date > end || k.status === 'happened') continue;
        out.push({ date: k.date, label: k.label, kind: 'view', href: `/thesis/${t.id}`, note: t.title || t.summary });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [site, quotes, theses, days, companyFilter]);
}

export function CatalystList({ items, limit = 10 }: { items: Catalyst[]; limit?: number }) {
  if (!items.length) return <div className="empty">Nothing scheduled in this window.</div>;
  return (
    <div className="list">
      {items.slice(0, limit).map((c, i) => (
        <div key={`${c.date}-${i}`} className="list-item">
          <div className="when">
            {fmtDate(c.date, false)}
            <div className="faint">{relativeDays(c.date)}</div>
          </div>
          <div className="min0">
            <div className="title">
              {c.href ? (
                c.external ? (
                  <a href={c.href} target="_blank" rel="noopener noreferrer">
                    {c.label}
                  </a>
                ) : (
                  <Link to={c.href}>{c.label}</Link>
                )
              ) : (
                c.label
              )}
            </div>
            <div className="meta">
              <span className="badge">{c.kind === 'view' ? 'My catalyst' : c.kind}</span>
              {c.tentative ? <span>Date estimated</span> : null}
              {c.note ? <span className="ink2">{c.note}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventDate({ e }: { e: EventItem }) {
  return (
    <span>
      {fmtDate(e.start)}
      {e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ''}
    </span>
  );
}

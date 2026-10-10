import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Section, Segmented } from '../components/ui.tsx';
import { ReportRow } from '../components/lists.tsx';
import { fmtDate, fmtMonth, LAYER_CODE, plural } from '../lib/format.ts';
import { industryLink } from '../lib/nodes.ts';
import type { LayerId, ReportMeta } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

type Kind = 'all' | 'claude' | 'sell-side';
type GroupBy = 'date' | 'company' | 'industry';

interface Group {
  key: string;
  title: string;
  sub?: string;
  href?: string;
  reports: ReportMeta[];
}

export default function ResearchPage() {
  const { site, allReports, index, canEdit, mode } = useStore();
  const [kind, setKind] = useState<Kind>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [layer, setLayer] = useState<'all' | LayerId>('all');
  const [q, setQ] = useState('');

  const hasSellSide = allReports.some((r) => r.kind === 'sell-side');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allReports
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => layer === 'all' || r.nodes.some((n) => n.startsWith(layer)) || r.companies.some((c) => site.companies[c]?.layers.includes(layer)))
      .filter((r) => {
        if (!needle) return true;
        const hay = [r.title, r.titleZh, r.subtitle, r.broker, ...(r.tags ?? []), ...r.companies.flatMap((c) => [site.companies[c]?.name, site.companies[c]?.nameZh, site.companies[c]?.symbol])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
  }, [allReports, kind, layer, q, site.companies]);

  const groups = useMemo<Group[]>(() => {
    if (groupBy === 'date') {
      const m = new Map<string, ReportMeta[]>();
      for (const r of filtered) {
        const k = r.date.slice(0, 7);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
      return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, reports]) => ({ key: k, title: fmtMonth(k), reports }));
    }
    if (groupBy === 'company') {
      const m = new Map<string, ReportMeta[]>();
      for (const r of filtered)
        for (const c of r.companies) {
          if (!site.companies[c]) continue;
          if (!m.has(c)) m.set(c, []);
          m.get(c)!.push(r);
        }
      return [...m.entries()]
        .sort((a, b) => b[1].length - a[1].length || site.companies[a[0]].name.localeCompare(site.companies[b[0]].name))
        .map(([c, reports]) => {
          const co = site.companies[c];
          return { key: c, title: co.name, sub: co.symbol ?? (co.listing === 'private' ? 'Private' : undefined), href: `/company/${c}`, reports };
        });
    }
    const m = new Map<string, ReportMeta[]>();
    for (const r of filtered) {
      const paths = new Set<string>();
      for (const n of r.nodes) {
        const [l, i] = n.split('/');
        if (i) paths.add(`${l}/${i}`);
      }
      if (!paths.size)
        for (const c of r.companies.slice(0, 2)) {
          const p = site.companies[c]?.primary.split('/').slice(0, 2).join('/');
          if (p) paths.add(p);
        }
      for (const p of paths) {
        if (!index.nodes.has(p)) continue;
        if (!m.has(p)) m.set(p, []);
        m.get(p)!.push(r);
      }
    }
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([p, reports]) => {
        const n = index.nodes.get(p)!;
        return { key: p, title: n.name, sub: `${LAYER_CODE[n.layer.id]} ${n.layer.name}`, href: industryLink(p), reports };
      });
  }, [filtered, groupBy, site.companies, index]);

  const pinned = filtered.filter((r) => r.pinned);
  const latest = filtered.filter((r) => !r.pinned).slice(0, 3);

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Research library</div>
            <h1 style={{ marginTop: 4 }}>Research, filed by company and industry</h1>
            <p className="lede">
              Long-form research written with Claude, each with a short English summary and the companies and industries it covers.
              {mode === 'owner' ? ' Your private vault (sell-side notes and private reports) is included and marked.' : ''}
            </p>
          </div>
          {canEdit ? (
            <button type="button" className="btn primary" onClick={() => openEditor({ kind: 'upload' })}>
              Add a report
            </button>
          ) : null}
        </header>

        <div className="row" style={{ marginBottom: 8 }}>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Filter by company, ticker or topic" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter reports" id="research-filter" />
          {hasSellSide ? (
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'claude', label: 'Claude research' },
                { value: 'sell-side', label: 'Sell-side' },
              ]}
            />
          ) : null}
          <select className="select" style={{ width: 'auto' }} value={layer} onChange={(e) => setLayer(e.target.value as 'all' | LayerId)} aria-label="Layer" id="research-layer">
            <option value="all">All layers</option>
            {site.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {LAYER_CODE[l.id]} {l.name}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
            {plural(filtered.length, 'report')}
          </span>
        </div>

        {pinned.length || latest.length ? (
          <Section eyebrow={pinned.length ? 'Pinned and latest' : 'Latest'} title="Start here">
            <div className="grid cols-3">
              {[...pinned, ...latest].slice(0, 6).map((r) => (
                <ReportCard key={r.id} r={r} />
              ))}
            </div>
          </Section>
        ) : null}

        <Section
          eyebrow="Library"
          title={groupBy === 'date' ? 'By month' : groupBy === 'company' ? 'By company' : 'By industry'}
          sub="Each group shows its five most recent reports; the rest fold away."
          tools={
            <Segmented
              label="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'date', label: 'Date' },
                { value: 'company', label: 'Company' },
                { value: 'industry', label: 'Industry' },
              ]}
            />
          }
        >
          {groups.length ? (
            <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
              {groups.map((g) => (
                <GroupCard key={g.key} g={g} shown={site.config.defaults.reportsShownCollapsed} />
              ))}
            </div>
          ) : (
            <div className="empty">No reports match.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function GroupCard({ g, shown }: { g: Group; shown: number }) {
  const { site } = useStore();
  const [open, setOpen] = useState(false);
  const visible = open ? g.reports : g.reports.slice(0, shown);
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--rule)' }}>
        <div className="row" style={{ gap: 8 }}>
          {g.href ? (
            <Link to={g.href} style={{ fontWeight: 600, color: 'var(--ink)' }}>
              {g.title}
            </Link>
          ) : (
            <b>{g.title}</b>
          )}
          {g.sub ? <span className="faint" style={{ fontSize: 'var(--step--2)' }}>{g.sub}</span> : null}
        </div>
        <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
          {plural(g.reports.length, 'report')}
        </span>
      </div>
      <div style={{ padding: '0 14px' }}>
        {visible.map((r) => (
          <ReportRow key={r.id} r={r} site={site} />
        ))}
      </div>
      {g.reports.length > shown ? (
        <div className="fold-toggle">
          <button type="button" className="btn sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Show fewer' : `Show all ${g.reports.length} (${g.reports.length - shown} more)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReportCard({ r }: { r: ReportMeta }) {
  const { site } = useStore();
  return (
    <Link to={`/report/${encodeURIComponent(r.id)}`} className="report-card">
      <div className="row" style={{ gap: 6 }}>
        <span className="badge">{r.kind === 'claude' ? 'Claude research' : r.kind === 'sell-side' ? r.broker || 'Sell-side' : 'Research'}</span>
        {r.reportType ? <span className="badge">{r.reportType}</span> : null}
        <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
          {fmtDate(r.date)}
        </span>
      </div>
      <span className="rt">{r.title}</span>
      {r.titleZh && r.titleZh !== r.title ? <span className="rz">{r.titleZh}</span> : null}
      {r.summary?.en?.length ? (
        <ul>
          {r.summary.en.slice(0, 2).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      ) : null}
      <div className="chips" style={{ marginTop: 'auto' }}>
        {r.companies.slice(0, 4).map((id) => {
          const c = site.companies[id];
          return c ? (
            <span key={id} className="chip">
              {c.symbol ? <span className="tk">{c.symbol}</span> : <span className="nm">{c.name}</span>}
            </span>
          ) : null;
        })}
      </div>
    </Link>
  );
}


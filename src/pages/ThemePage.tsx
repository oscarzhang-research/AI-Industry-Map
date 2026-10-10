import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, Crumbs } from '../components/ui.tsx';
import { CompanyTable } from '../components/CompanyTable.tsx';
import { NodeContent, splitRecords } from '../components/NodeContent.tsx';
import { useIndices } from '../lib/hooks.ts';
import { companyIdsOfRecord } from '../lib/nodes.ts';
import { viewByCompany } from '../lib/views.ts';
import { basketReturns } from './LayerPage.tsx';
import type { AnyRecord } from '../lib/types.ts';

export default function ThemePage() {
  const { id } = useParams();
  const { site, quotes, allRecords, allReports, news } = useStore();
  const theme = site.themes.find((t) => t.id === id);
  const indices = useIndices();
  const members = useMemo(() => new Set(theme?.companies ?? []), [theme]);
  const records = useMemo(() => (theme ? allRecords.filter((r) => aboutTheme(r, theme.id, members)) : []), [allRecords, theme, members]);
  const { theses, notes } = splitRecords(records);
  const reports = useMemo(() => (theme ? allReports.filter((r) => r.tags?.includes(theme.id) || r.companies.some((c) => members.has(c))) : []), [allReports, theme, members]);
  const tNews = useMemo(() => (theme ? news.filter((n) => n.themes?.includes(theme.id) || n.companies.some((c) => members.has(c))) : []), [news, theme, members]);
  const views = useMemo(() => viewByCompany(allRecords), [allRecords]);

  if (!theme) {
    return (
      <div className="page">
        <div className="wrap">
          <h1>Unknown theme</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            <Link to="/themes">All themes</Link>
          </p>
        </div>
      </div>
    );
  }
  const br = basketReturns(indices?.series.find((s) => s.kind === 'theme' && s.id === theme.id));
  return (
    <div className="page">
      <div className="wrap">
        <Crumbs items={[{ label: 'Themes', to: '/themes' }, { label: theme.name }]} />
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Theme · {theme.nameZh}</div>
            <h1 style={{ marginTop: 4 }}>{theme.name}</h1>
            <p className="lede">{theme.description}</p>
          </div>
          <div className="grid cols-3" style={{ minWidth: 300 }}>
            <div className="stat">
              <span className="label">Basket YTD</span>
              <span className="value">
                <Change value={br.ytd} />
              </span>
            </div>
            <div className="stat">
              <span className="label">1 year</span>
              <span className="value">
                <Change value={br.y1} />
              </span>
            </div>
            <div className="stat">
              <span className="label">Since 2023</span>
              <span className="value">
                <Change value={br.ai} digits={0} />
              </span>
            </div>
          </div>
        </header>
        <CompanyTable companies={theme.companies.map((c) => site.companies[c]).filter(Boolean)} quotes={quotes.quotes} views={views} />
        <NodeContent theses={theses} notes={notes} reports={reports} news={tNews} scopeLabel={theme.name} addPreset={{ subject: { kind: 'theme', theme: theme.id }, tags: [theme.id] }} />
      </div>
    </div>
  );
}

function aboutTheme(r: AnyRecord, id: string, members: Set<string>): boolean {
  if (r.tags?.includes(id)) return true;
  if (r.type === 'thesis' && r.subject?.kind === 'theme' && r.subject.theme === id) return true;
  if (r.type === 'note' && r.subjects?.some((s) => s.kind === 'theme' && s.theme === id)) return true;
  return companyIdsOfRecord(r).some((c) => members.has(c));
}

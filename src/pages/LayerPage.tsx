import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, Crumbs, DirectionBadge, Section } from '../components/ui.tsx';
import { CompanyTable } from '../components/CompanyTable.tsx';
import { NodeContent, splitRecords } from '../components/NodeContent.tsx';
import { useIndices, useKpis } from '../lib/hooks.ts';
import { KpiCard } from '../components/kpis.tsx';
import { industryLink, recordsForNode } from '../lib/nodes.ts';
import { display, latestOutlook, viewByCompany } from '../lib/views.ts';
import { LAYER_CODE, POSITION_LABEL } from '../lib/format.ts';
import type { IndexSeries, LayerId } from '../lib/types.ts';

export function basketReturns(s: IndexSeries | undefined): { ytd?: number; y1?: number; ai?: number } {
  if (!s || s.v.length < 2) return {};
  const last = s.v[s.v.length - 1];
  const lastDate = s.d[s.d.length - 1];
  const y0 = `${lastDate.slice(0, 4)}-01-01`;
  const iy = s.d.findIndex((d) => d >= y0);
  const yearAgo = `${Number(lastDate.slice(0, 4)) - 1}${lastDate.slice(4)}`;
  const i1 = s.d.findIndex((d) => d >= yearAgo);
  return {
    ytd: iy > 0 ? last / s.v[iy - 1] - 1 : undefined,
    y1: i1 > 0 ? last / s.v[i1 - 1] - 1 : undefined,
    ai: last / s.v[0] - 1,
  };
}

export default function LayerPage() {
  const { layerId } = useParams();
  const { site, quotes, allRecords, allReports, news, index } = useStore();
  const layer = index.layerById.get(layerId as LayerId);
  const indices = useIndices();
  const kpis = useKpis();
  const [industryFilter, setIndustryFilter] = useState<string>('all');

  const members = useMemo(() => new Set(layer ? index.companiesUnder(layer.id) : []), [layer, index]);
  const records = useMemo(() => (layer ? recordsForNode(allRecords, layer.id, members) : []), [allRecords, layer, members]);
  const { theses, notes } = splitRecords(records);
  const reports = useMemo(
    () => allReports.filter((r) => r.nodes?.some((n) => n.startsWith(`${layer?.id}`)) || r.companies?.some((c) => members.has(c))),
    [allReports, layer, members],
  );
  const layerNews = useMemo(() => news.filter((n) => n.nodes.some((p) => p.startsWith(`${layer?.id}`)) || n.companies.some((c) => members.has(c))), [news, layer, members]);
  const views = useMemo(() => viewByCompany(allRecords), [allRecords]);
  const outlook = latestOutlook(allRecords);
  const stance = outlook ? display(outlook).layerStances?.[layerId as LayerId] : undefined;

  if (!layer) return <NotFoundLayer />;
  const basket = indices?.series.find((s) => s.kind === 'layer' && s.id === layer.id);
  const br = basketReturns(basket);
  const tableCompanies = [...members]
    .map((id) => site.companies[id])
    .filter(Boolean)
    .filter((c) => industryFilter === 'all' || c.placements.some((p) => p.startsWith(industryFilter)));
  const symbolName = (sym: string) => Object.values(site.companies).find((c) => c.tickers.some((t) => t.symbol === sym))?.name ?? sym;
  const below = site.layers.find((l) => l.order === layer.order - 1);
  const above = site.layers.find((l) => l.order === layer.order + 1);

  return (
    <div className="page" data-layer={layer.id}>
      <div className="wrap">
        <Crumbs items={[{ label: 'Map', to: '/' }, { label: `${LAYER_CODE[layer.id]} ${layer.name}` }]} />
        <header className="layer-head">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="code">
              {LAYER_CODE[layer.id]} · {layer.nameZh}
            </span>
            {stance ? (
              <span className="row" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
                  My stance
                </span>
                <DirectionBadge direction={stance.direction} />
              </span>
            ) : null}
          </div>
          <h1 style={{ marginTop: 4 }}>{layer.name}</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            {layer.tagline}
          </p>
          <p style={{ marginTop: 10, maxWidth: '80ch', color: 'var(--ink-2)' }}>{layer.description}</p>
          <div className="grid cols-4" style={{ marginTop: 18 }}>
            <div className="stat">
              <span className="label">Companies</span>
              <span className="value">{members.size}</span>
            </div>
            <div className="stat">
              <span className="label">Layer index YTD</span>
              <span className="value">
                <Change value={br.ytd} />
              </span>
            </div>
            <div className="stat">
              <span className="label">Layer index 1Y</span>
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
          <p className="faint" style={{ marginTop: 10, fontSize: 'var(--step--2)' }}>
            Layer index: market-cap weighted, each company counted once in its main layer
            {basket?.top?.length ? ` (largest weights ${basket.top.map((x) => `${symbolName(x.s)} ${Math.round(x.w * 100)}%`).join(', ')})` : ''}. Industry cards below use
            equal-weight baskets.
          </p>
        </header>

        <div className="grid cols-3" style={{ '--gap': '14px' } as React.CSSProperties}>
          {layer.industries.map((ind) => {
            const ids = new Set(ind.segments.flatMap((s) => s.companies));
            const ib = basketReturns(indices?.series.find((s) => s.kind === 'industry' && s.id === ind.path));
            const positions = ind.segments.filter((s) => !s.ref);
            return (
              <Link key={ind.id} to={industryLink(ind.path)} className="view-card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b style={{ fontSize: 'var(--step-1)' }}>{ind.name}</b>
                  <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
                    {ind.nameZh}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
                  {ind.description}
                </p>
                <div className="chips">
                  {positions.slice(0, 6).map((s) => (
                    <span key={s.id} className="chip" title={POSITION_LABEL[s.position]}>
                      <span className={`pos ${s.position}`}>{s.position === 'upstream' ? 'UP' : s.position === 'downstream' ? 'DOWN' : 'MID'}</span>
                      <span className="nm">{s.name}</span>
                    </span>
                  ))}
                </div>
                <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                  <div className="stat">
                    <span className="label">Companies</span>
                    <span className="value">{ids.size}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Basket YTD</span>
                    <span className="value">
                      <Change value={ib.ytd} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <Section eyebrow="What to watch" title="Signals for this layer">
          <ul className="prose" style={{ paddingLeft: '1.2em', margin: 0 }}>
            {layer.watch.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>

        {kpis?.indicators.some((k) => k.layer === layer.id) ? (
          <Section
            eyebrow="Indicators"
            title="Key numbers for this layer"
            tools={
              <Link to="/indicators" className="btn sm">
                All indicators
              </Link>
            }
          >
            <div className="grid cols-2 kpi-grid">
              {kpis.indicators
                .filter((k) => k.layer === layer.id)
                .map((k) => (
                  <KpiCard key={k.id} kpi={k} />
                ))}
            </div>
          </Section>
        ) : null}

        <Section
          eyebrow="Companies"
          title={`All ${members.size} companies`}
          tools={
            <select className="select" style={{ width: 'auto' }} value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} aria-label="Filter by industry" id="layer-industry-filter">
              <option value="all">All industries</option>
              {layer.industries.map((i) => (
                <option key={i.id} value={i.path}>
                  {i.name}
                </option>
              ))}
            </select>
          }
        >
          <CompanyTable companies={tableCompanies} quotes={quotes.quotes} views={views} />
        </Section>

        <NodeContent theses={theses} notes={notes} reports={reports} news={layerNews} scopeLabel={`the ${layer.name} layer`} addPreset={{ subject: { kind: 'node', node: layer.id } }} />

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 40 }}>
          {below ? (
            <Link className="btn" to={`/layer/${below.id}`}>
              ↓ {LAYER_CODE[below.id]} {below.name}
            </Link>
          ) : (
            <span />
          )}
          {above ? (
            <Link className="btn" to={`/layer/${above.id}`}>
              ↑ {LAYER_CODE[above.id]} {above.name}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NotFoundLayer() {
  return (
    <div className="page">
      <div className="wrap">
        <h1>Unknown layer</h1>
        <p className="lede" style={{ marginTop: 8 }}>
          <Link to="/">Back to the map</Link>
        </p>
      </div>
    </div>
  );
}

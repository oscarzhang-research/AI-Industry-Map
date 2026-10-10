import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, CompanyChip, Crumbs, Section } from '../components/ui.tsx';
import { CompanyTable } from '../components/CompanyTable.tsx';
import { NodeContent, splitRecords } from '../components/NodeContent.tsx';
import { useIndices } from '../lib/hooks.ts';
import { industryLink, recordsForNode } from '../lib/nodes.ts';
import { viewByCompany } from '../lib/views.ts';
import { LAYER_CODE } from '../lib/format.ts';
import { basketReturns } from './LayerPage.tsx';
import type { Position } from '../lib/types.ts';

const COLS: Position[] = ['upstream', 'midstream', 'downstream'];
const COL_LABEL: Record<Position, string> = { upstream: 'Upstream · inputs', midstream: 'Midstream · the industry', downstream: 'Downstream · customers' };

export default function IndustryPage() {
  const { layerId, industryId } = useParams();
  const { site, quotes, allRecords, allReports, news, index } = useStore();
  const path = `${layerId}/${industryId}`;
  const node = index.nodes.get(path);
  const indices = useIndices();
  const members = useMemo(() => new Set(index.companiesUnder(path)), [index, path]);
  const records = useMemo(() => recordsForNode(allRecords, path, members), [allRecords, path, members]);
  const { theses, notes } = splitRecords(records);
  const reports = useMemo(() => allReports.filter((r) => r.nodes?.some((n) => n.startsWith(path)) || r.companies?.some((c) => members.has(c))), [allReports, path, members]);
  const indNews = useMemo(() => news.filter((n) => n.nodes.some((p) => p.startsWith(path)) || n.companies.some((c) => members.has(c))), [news, path, members]);
  const views = useMemo(() => viewByCompany(allRecords), [allRecords]);

  if (!node || node.kind !== 'industry' || !node.industry) {
    return (
      <div className="page">
        <div className="wrap">
          <h1>Unknown industry</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            <Link to="/">Back to the map</Link>
          </p>
        </div>
      </div>
    );
  }
  const ind = node.industry;
  const layer = node.layer;
  const br = basketReturns(indices?.series.find((s) => s.kind === 'industry' && s.id === path));

  return (
    <div className="page" data-layer={layer.id}>
      <div className="wrap">
        <Crumbs items={[{ label: 'Map', to: '/' }, { label: `${LAYER_CODE[layer.id]} ${layer.name}`, to: `/layer/${layer.id}` }, { label: ind.name }]} />
        <header className="layer-head">
          <span className="code">
            {LAYER_CODE[layer.id]} {layer.name} · {ind.nameZh}
          </span>
          <h1 style={{ marginTop: 4 }}>{ind.name}</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            {ind.description}
          </p>
          <div className="grid cols-2" style={{ marginTop: 16, '--gap': '20px' } as React.CSSProperties}>
            {ind.drivers?.length ? (
              <div>
                <div className="eyebrow">Drivers</div>
                <div className="chips" style={{ marginTop: 6 }}>
                  {ind.drivers.map((d) => (
                    <span key={d} className="chip">
                      <span className="nm">{d}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {ind.metrics?.length ? (
              <div>
                <div className="eyebrow">Metrics to track</div>
                <div className="chips" style={{ marginTop: 6 }}>
                  {ind.metrics.map((d) => (
                    <span key={d} className="chip">
                      <span className="nm">{d}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid cols-4" style={{ marginTop: 18 }}>
            <div className="stat">
              <span className="label">Companies</span>
              <span className="value">{members.size}</span>
            </div>
            <div className="stat">
              <span className="label">Basket YTD</span>
              <span className="value">
                <Change value={br.ytd} />
              </span>
            </div>
            <div className="stat">
              <span className="label">Basket 1Y</span>
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

        <Section eyebrow="Value chain" title="Upstream to downstream" sub="Segments that feed this industry, the industry itself, and where its output goes. Dashed cards link to other parts of the map.">
          <div className="chain">
            {COLS.map((col) => {
              const segs = ind.segments.filter((s) => s.position === col);
              return (
                <div className="chain-col" key={col}>
                  <div className="eyebrow">
                    <span>{COL_LABEL[col]}</span>
                    <span>{segs.length}</span>
                  </div>
                  {segs.length ? (
                    segs.map((s) =>
                      s.ref ? (
                        <Link key={s.id} className="chain-seg ref" to={industryLink(s.ref)} id={s.id}>
                          <h4>→ {s.name}</h4>
                          <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
                            {index.nodes.get(s.ref)?.name} · {index.nodes.get(s.ref)?.layer.name}
                          </span>
                        </Link>
                      ) : (
                        <div key={s.id} className="chain-seg" id={s.id}>
                          <h4>
                            {s.name} <span className="faint" style={{ fontWeight: 400 }}>{s.nameZh}</span>
                          </h4>
                          <div className="chips">
                            {s.companies.map((id) => {
                              const c = site.companies[id];
                              return c ? <CompanyChip key={id} company={c} quote={c.symbol ? quotes.quotes[c.symbol] : undefined} show="d1" view={views.get(id)} /> : null;
                            })}
                          </div>
                        </div>
                      ),
                    )
                  ) : (
                    <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
                      —
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section eyebrow="Companies" title={`${members.size} companies`}>
          <CompanyTable companies={[...members].map((id) => site.companies[id]).filter(Boolean)} quotes={quotes.quotes} views={views} />
        </Section>

        <NodeContent theses={theses} notes={notes} reports={reports} news={indNews} scopeLabel={ind.name} addPreset={{ subject: { kind: 'node', node: path } }} />

        <div className="row" style={{ marginTop: 40, flexWrap: 'wrap' }}>
          <span className="muted">Other industries in {layer.name}:</span>
          {layer.industries
            .filter((i) => i.id !== ind.id)
            .map((i) => (
              <Link key={i.id} to={industryLink(i.path)} className="chip">
                <span className="nm">{i.name}</span>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}

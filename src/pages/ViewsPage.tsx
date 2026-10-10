import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, Conviction, DirectionBadge, ExampleBadge, PrivateBadge, Section, Segmented } from '../components/ui.tsx';
import { ViewCard } from '../components/ViewCard.tsx';
import { RiskRewardScatter, type ScatterPoint } from '../components/charts.tsx';
import { useThesisSeries } from '../lib/useThesis.ts';
import { thesisPerformance, type ThesisPerformance } from '../lib/finance.ts';
import { display, subjectLabel, theses as thesesOf } from '../lib/views.ts';
import { fmtDate, fmtPct, LAYER_CODE, STATUS_LABEL, todayISO } from '../lib/format.ts';
import type { Direction, LayerId, ThesisRecord } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

type StatusFilter = 'active' | 'closed' | 'all';
type DirFilter = 'all' | Direction;
type SortKey = 'newest' | 'best' | 'worst' | 'upside' | 'conviction' | 'review';

export default function ViewsPage() {
  const { site, allRecords, index, canEdit } = useStore();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [dir, setDir] = useState<DirFilter>('all');
  const [layer, setLayer] = useState<'all' | LayerId>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const today = todayISO(site.config.site.timezone);

  const all = useMemo(() => thesesOf(allRecords).map((t) => display(t)), [allRecords]);
  const seriesOf = useThesisSeries(all, site);
  const nodeName = (p: string) => index.nodes.get(p)?.name;

  const rows = useMemo(() => {
    return all.map((t) => {
      const { series, bench, symbol } = seriesOf(t);
      return { t, perf: thesisPerformance(t, series, bench, today), series, bench, symbol, layer: layerOf(t, site.companies) };
    });
  }, [all, seriesOf, today, site.companies]);

  const filtered = rows
    .filter((r) => (status === 'all' ? true : status === 'active' ? r.t.status === 'active' : r.t.status !== 'active'))
    .filter((r) => dir === 'all' || r.t.direction === dir)
    .filter((r) => layer === 'all' || r.layer === layer)
    .sort((a, b) => {
      switch (sort) {
        case 'best':
          return (b.perf.ret ?? -9) - (a.perf.ret ?? -9);
        case 'worst':
          return (a.perf.ret ?? 9) - (b.perf.ret ?? 9);
        case 'upside':
          return (b.perf.upside ?? -9) - (a.perf.upside ?? -9);
        case 'conviction':
          return (b.t.conviction ?? 0) - (a.t.conviction ?? 0);
        case 'review':
          return (a.t.reviewOn ?? '9999') < (b.t.reviewOn ?? '9999') ? -1 : 1;
        default:
          return a.t.createdAt < b.t.createdAt ? 1 : -1;
      }
    });

  const active = rows.filter((r) => r.t.status === 'active');
  const points: ScatterPoint[] = active
    .filter((r) => r.perf.upside !== undefined && r.t.conviction)
    .map((r) => ({ id: r.t.id, label: r.symbol ?? subjectLabel(r.t, site, nodeName), conviction: r.t.conviction!, upside: r.perf.upside!, direction: r.t.direction }));

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Views</div>
            <h1 style={{ marginTop: 4 }}>Calls on the stack</h1>
            <p className="lede">
              Long-horizon views on companies, industries and layers. Each is tracked every trading day against the price it was written at, its target and a
              benchmark.
            </p>
          </div>
          {canEdit ? (
            <button type="button" className="btn primary" onClick={() => openEditor({ kind: 'thesis' })}>
              New view
            </button>
          ) : null}
        </header>

        <div className="grid cols-4">
          <Stat label="Active views" value={String(active.length)} />
          <Stat label="Long · short · watching" value={`${active.filter((r) => r.t.direction === 'long').length} · ${active.filter((r) => r.t.direction === 'short').length} · ${active.filter((r) => r.t.direction === 'watch' || r.t.direction === 'neutral').length}`} />
          <Stat label="Median since open" value={<Change value={median(active.map((r) => r.perf.ret))} />} />
          <Stat label="Median vs benchmark" value={<Change value={median(active.map((r) => r.perf.excess))} />} />
        </div>

        {canEdit ? <TrackRecord rows={rows} /> : null}

        {points.length >= 2 ? (
          <Section eyebrow="Risk and reward" title="Conviction against remaining upside" sub="Views with a target. Upside is measured from the last close to the target, in the direction of the call.">
            <div className="card">
              <RiskRewardScatter points={points} onPick={(id) => navigate(`/thesis/${id}`)} />
            </div>
          </Section>
        ) : null}

        <Section
          eyebrow="All views"
          title={`${filtered.length} ${filtered.length === 1 ? 'view' : 'views'}`}
          tools={
            <Segmented
              label="Layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'cards', label: 'Cards' },
                { value: 'table', label: 'Table' },
              ]}
            />
          }
        >
          <div className="row" style={{ marginBottom: 14 }}>
            <Segmented
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'closed', label: 'Closed' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Segmented
              label="Direction"
              value={dir}
              onChange={setDir}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'long', label: 'Long' },
                { value: 'short', label: 'Short' },
                { value: 'watch', label: 'Watching' },
              ]}
            />
            <select className="select" style={{ width: 'auto' }} value={layer} onChange={(e) => setLayer(e.target.value as 'all' | LayerId)} aria-label="Layer" id="views-layer">
              <option value="all">All layers</option>
              {site.layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {LAYER_CODE[l.id]} {l.name}
                </option>
              ))}
            </select>
            <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" id="views-sort">
              <option value="newest">Newest first</option>
              <option value="best">Best since open</option>
              <option value="worst">Worst since open</option>
              <option value="upside">Most upside to target</option>
              <option value="conviction">Highest conviction</option>
              <option value="review">Review date</option>
            </select>
          </div>
          {!filtered.length ? (
            <div className="empty">
              No views match.{canEdit ? ' Use “New view” to write one.' : ''}
            </div>
          ) : layout === 'cards' ? (
            <div className="grid cols-3">
              {filtered.map((r) => (
                <ViewCard key={r.t.id} thesis={r.t} site={site} series={r.series} bench={r.bench} nodeName={nodeName} />
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Call</th>
                    <th>Conviction</th>
                    <th>Opened</th>
                    <th className="n">Since open</th>
                    <th className="n">vs index</th>
                    <th className="n">To target</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ t, perf, symbol }) => (
                    <tr key={t.id}>
                      <td style={{ minWidth: 200 }}>
                        <Link to={`/thesis/${t.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {subjectLabel(t, site, nodeName)}
                        </Link>
                        {symbol ? <span className="faint tk"> {symbol}</span> : null} {t.example ? <ExampleBadge /> : null} {t.visibility === 'private' ? <PrivateBadge /> : null}
                        <div className="muted" style={{ fontSize: 'var(--step--2)', maxWidth: '52ch' }}>
                          {t.summary}
                        </div>
                      </td>
                      <td>
                        <DirectionBadge direction={t.direction} />
                      </td>
                      <td>
                        <Conviction value={t.conviction} />
                      </td>
                      <td className="num">{fmtDate(t.createdAt)}</td>
                      <td className="n">
                        <Change value={perf.ret} />
                      </td>
                      <td className="n">
                        <Change value={perf.excess} />
                      </td>
                      <td className="n">{perf.upside !== undefined ? fmtPct(perf.upside) : '—'}</td>
                      <td>{STATUS_LABEL[t.status]}</td>
                      <td className={t.status === 'active' && t.reviewOn && t.reviewOn <= today ? 'down' : 'muted'}>{t.reviewOn ? fmtDate(t.reviewOn, false) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <p className="faint" style={{ marginTop: 28, fontSize: 'var(--step--2)', maxWidth: '90ch' }}>
          How views are scored: the return runs from the base price written into the view (or the close on the day it was opened) to the latest close, signed so that a
          correct short shows a gain. “vs index” subtracts the benchmark’s move over the same days. Prices are split-adjusted daily closes from Yahoo Finance;
          dividends are excluded. A view is only marked as hit, stopped or expired after its author confirms it. {site.config.site.disclaimer}
        </p>
      </div>
    </div>
  );
}

function TrackRecord({ rows }: { rows: { t: ThesisRecord; perf: ThesisPerformance }[] }) {
  const closed = rows.filter((r) => r.t.status !== 'active' && r.t.status !== 'withdrawn' && !r.t.example);
  const scored = closed.filter((r) => r.perf.ret !== undefined);
  const right = closed.filter((r) => r.t.closed?.outcome === 'right' || (!r.t.closed?.outcome && (r.perf.ret ?? 0) > 0)).length;
  const beat = scored.filter((r) => (r.perf.excess ?? 0) > 0).length;
  return (
    <Section eyebrow="Only you see this" title="Track record" sub="Closed views, examples excluded. Visitors do not see this summary yet; ask Claude to make it public once there is enough history.">
      {closed.length ? (
        <div className="grid cols-4">
          <Stat label="Closed views" value={String(closed.length)} />
          <Stat label="Right" value={`${right} of ${closed.length}`} />
          <Stat label="Beat the benchmark" value={scored.length ? `${beat} of ${scored.length}` : '—'} />
          <Stat label="Median excess" value={<Change value={median(scored.map((r) => r.perf.excess))} />} />
        </div>
      ) : (
        <div className="empty">No closed views yet. When a view hits its target, stop or horizon, you confirm it on the view’s page and it is scored here.</div>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card flat">
      <div className="stat">
        <span className="label">{label}</span>
        <span className="value num">{value}</span>
      </div>
    </div>
  );
}

function median(xs: (number | undefined)[]): number | undefined {
  const v = xs.filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function layerOf(t: ThesisRecord, companies: Record<string, { primaryLayer: LayerId }>): LayerId | undefined {
  if (t.subject?.company) return companies[t.subject.company]?.primaryLayer;
  if (t.subject?.node) return t.subject.node.split('/')[0] as LayerId;
  return undefined;
}

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, CompanyChip, Crumbs, LayerBadge, Section, Segmented } from '../components/ui.tsx';
import { PriceChart, type Overlay } from '../components/charts.tsx';
import { ValuationHistory } from '../components/valuation.tsx';
import { EarningsSection } from '../components/earnings.tsx';
import { NodeContent, splitRecords } from '../components/NodeContent.tsx';
import { CatalystList, useCatalysts } from '../components/lists.tsx';
import { useSeries } from '../lib/hooks.ts';
import { industryLink, newsForCompany, recordsForCompany, reportsForCompany } from '../lib/nodes.ts';
import { display, isThesis, viewByCompany } from '../lib/views.ts';
import { MARKET_LABEL, marketOf } from '../lib/symbols.ts';
import { fmtCompact, fmtDate, fmtMultiple, fmtPrice, POSITION_LABEL, TIER_LABEL } from '../lib/format.ts';
import type { Company, ThesisRecord } from '../lib/types.ts';

const REC_LABEL: Record<string, string> = {
  strong_buy: 'Strong buy',
  buy: 'Buy',
  hold: 'Hold',
  underperform: 'Underperform',
  sell: 'Sell',
  none: '—',
};

interface TimelineItem {
  date: string;
  kind: 'view' | 'update' | 'note' | 'report' | 'news' | 'revision' | 'closed';
  label: string;
  href?: string;
  external?: boolean;
  key?: boolean;
}

export default function CompanyPage() {
  const { companyId } = useParams();
  const { site, quotes, allRecords, allReports, news, index } = useStore();
  const company = companyId ? site.companies[companyId] : undefined;
  const listed = company?.tickers.filter((t) => quotes.quotes[t.symbol]) ?? [];
  const [symbol, setSymbol] = useState<string | undefined>(undefined);
  const activeSymbol = symbol && listed.some((t) => t.symbol === symbol) ? symbol : company?.symbol;
  const { series, loading } = useSeries(company?.listing === 'listed' ? activeSymbol : undefined);

  const records = useMemo(() => (company ? recordsForCompany(allRecords, company.id) : []), [allRecords, company]);
  const { theses, notes } = splitRecords(records);
  const reports = useMemo(() => (company ? reportsForCompany(allReports, company.id) : []), [allReports, company]);
  const coNews = useMemo(() => (company ? newsForCompany(news, company.id) : []), [news, company]);
  const views = useMemo(() => viewByCompany(allRecords), [allRecords]);
  const self = useMemo(() => new Set(company ? [company.id] : []), [company]);
  const catalysts = useCatalysts(site, quotes.quotes, theses, 120, self);

  // Theses about this company (not ones where it is only "related") drive the chart overlays.
  const own = useMemo(() => theses.filter((t) => t.subject?.company === company?.id).map((t) => display(t)), [theses, company]);
  const overlays = useMemo<Overlay[]>(
    () =>
      own
        .filter((t) => (t.subject?.symbol ?? company?.symbol) === activeSymbol)
        .map((t) => ({ thesis: t, showTarget: true })),
    [own, activeSymbol, company],
  );

  const timeline = useMemo(() => buildTimeline(company, records, reports, coNews), [company, records, reports, coNews]);

  if (!company) {
    return (
      <div className="page">
        <div className="wrap">
          <h1>Unknown company</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            <Link to="/">Back to the map</Link>
          </p>
        </div>
      </div>
    );
  }

  const q = activeSymbol ? quotes.quotes[activeSymbol] : undefined;
  const primary = index.nodes.get(company.primary);
  const layer = index.layerById.get(company.primaryLayer)!;
  const peers = primary?.segment
    ? primary.segment.companies.filter((id) => id !== company.id).map((id) => site.companies[id]).filter(Boolean)
    : [];
  const acquirer = company.acquiredBy ? site.companies[company.acquiredBy] : undefined;

  return (
    <div className="page" data-layer={layer.id}>
      <div className="wrap">
        <Crumbs
          items={[
            { label: 'Map', to: '/' },
            { label: layer.name, to: `/layer/${layer.id}` },
            ...(primary?.industry ? [{ label: primary.industry.name, to: industryLink(primary.industry.path) }] : []),
            { label: company.name },
          ]}
        />

        <header className="co-head">
          <div className="min0">
            <div className="names">
              <h1>{company.name}</h1>
              {company.nameZh && company.nameZh !== company.name ? <span className="zh">{company.nameZh}</span> : null}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              {company.layers.map((l) => (
                <LayerBadge key={l} layer={l} name={index.layerById.get(l)?.name} />
              ))}
              <span className="badge">{TIER_LABEL[company.tier]}</span>
              {company.country ? <span className="badge">{company.country}</span> : null}
              {company.listing === 'private' ? <span className="badge">Private</span> : null}
              {company.listing === 'acquired' ? <span className="badge">Acquired</span> : null}
              {company.ecosystems?.map((e) => {
                const eco = site.ecosystems.find((x) => x.id === e);
                return eco ? (
                  <span key={e} className="badge" title={eco.description}>
                    {eco.name}
                  </span>
                ) : null;
              })}
            </div>
            {company.tickers.length ? (
              <div className="tickers" style={{ marginTop: 8 }}>
                {company.tickers.map((t) => `${t.symbol}${t.exchange ? ` · ${t.exchange}` : ''}`).join('   ')}
              </div>
            ) : null}
            {company.description ? (
              <p style={{ marginTop: 10, maxWidth: '75ch', color: 'var(--ink-2)' }}>{company.description}</p>
            ) : null}
            {company.website ? (
              <a href={company.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--step--1)', marginTop: 6, display: 'inline-block' }}>
                {company.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            ) : null}
          </div>
          {q ? (
            <div className="co-price">
              <div className="p num">{fmtPrice(q.c, q.ccy)}</div>
              <div className="d">
                <Change value={q.r.d1} /> <span className="muted" style={{ fontWeight: 400 }}>1D</span>
              </div>
              <div className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 2 }}>
                Close {fmtDate(q.d)} · {MARKET_LABEL[marketOf(q.s)]}
              </div>
            </div>
          ) : company.listing === 'private' && company.private?.valuation?.usd ? (
            <div className="co-price">
              <div className="p num">{fmtCompact(company.private.valuation.usd)}</div>
              <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
                Last valuation{company.private.valuation.date ? ` · ${company.private.valuation.date}` : ''}
              </div>
              {company.private.valuation.round ? <div className="faint" style={{ fontSize: 'var(--step--2)' }}>{company.private.valuation.round}</div> : null}
            </div>
          ) : null}
        </header>

        {company.listing === 'listed' && q ? (
          <div className="kpis" aria-label="Key figures">
            <Kpi label="Market cap" value={q.mcapUsd ? fmtCompact(q.mcapUsd) : q.mcap ? fmtCompact(q.mcap, q.ccy) : '—'} />
            <Kpi label="YTD" value={<Change value={q.r.ytd} />} />
            <Kpi label="1 year" value={<Change value={q.r.y1} />} />
            <Kpi label="Since 2023" value={<Change value={q.r.ai} digits={0} />} />
            <Kpi label="P/E fwd · ttm" value={`${fmtMultiple(q.fpe)} · ${fmtMultiple(q.pe)}`} />
            <Kpi
              label={`Consensus${q.tgtN ? ` (${q.tgtN})` : ''}`}
              value={q.tgt ? <span>{fmtPrice(q.tgt, q.ccy)} <Change value={q.tgt / q.c - 1} className="delta" /></span> : '—'}
            />
          </div>
        ) : null}

        {company.listing !== 'listed' ? <PrivateBlock company={company} acquirer={acquirer} /> : null}

        <div className="thesis-grid" style={{ marginTop: 24 }}>
          <div className="min0">
            {company.listing === 'listed' ? (
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="eyebrow">Daily close</div>
                    <div className="muted" style={{ fontSize: 'var(--step--2)' }}>
                      {overlays.length ? 'Dots mark when a view was opened or revised. Lines show base, target and stop.' : 'Split-adjusted closing prices.'}
                    </div>
                  </div>
                  {listed.length > 1 ? (
                    <Segmented label="Listing" value={activeSymbol ?? ''} onChange={setSymbol} options={listed.map((t) => ({ value: t.symbol, label: t.symbol }))} />
                  ) : null}
                </div>
                <div style={{ marginTop: 8 }}>
                  {series ? (
                    <PriceChart series={series} overlays={overlays} ccy={q?.ccy} />
                  ) : loading ? (
                    <div style={{ height: 360, display: 'grid', placeItems: 'center' }}>
                      <span className="spinner" />
                    </div>
                  ) : (
                    <div className="empty">No price history yet. It appears after the next market-data run.</div>
                  )}
                </div>
                {q ? (
                  <div className="chart-foot">
                    <span>
                      52-week range {fmtPrice(q.lo52, q.ccy)} – {fmtPrice(q.hi52, q.ccy)}
                    </span>
                    {q.rec ? <span>Street: {REC_LABEL[q.rec] ?? q.rec}</span> : null}
                    {q.ps ? <span>P/S {fmtMultiple(q.ps)}</span> : null}
                    {q.earn ? (
                      <span>
                        Next earnings {fmtDate(q.earn)}
                        {q.earnEst ? ' (est.)' : ''}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {company.listing === 'listed' && series ? <ValuationHistory series={series} ccy={q?.ccy} /> : null}
          </div>

          <aside className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
            <div className="card">
              <div className="eyebrow">Where it sits</div>
              <ul className="list" style={{ marginTop: 6, listStyle: 'none', padding: 0 }}>
                {company.placements.map((p) => {
                  const n = index.nodes.get(p);
                  if (!n) return null;
                  return (
                    <li key={p} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--rule)', gap: 8 }}>
                      {n.segment ? <span className={`pos ${n.segment.position}`}>{POSITION_LABEL[n.segment.position]}</span> : null}
                      <Link to={industryLink(p)} className="min0">
                        {n.industry?.name}
                        {n.segment ? ` · ${n.segment.name}` : ''}
                      </Link>
                      {p === company.primary ? <span className="faint" style={{ fontSize: 'var(--step--2)' }}>primary</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="card">
              <div className="eyebrow">Coming up</div>
              <div style={{ marginTop: 4 }}>
                <CatalystList items={catalysts} limit={6} />
              </div>
            </div>
          </aside>
        </div>

        {company.listing === 'listed' && activeSymbol ? <EarningsSection symbol={activeSymbol} quote={q} /> : null}

        <NodeContent theses={theses} notes={notes} reports={reports} news={coNews} scopeLabel={company.name} addPreset={{ subject: { kind: 'company', company: company.id } }} />

        {timeline.length ? (
          <Section eyebrow="History" title="Timeline" sub="Views, revisions, notes, research and news about this company, newest first.">
            <ol className="timeline">
              {timeline.slice(0, 40).map((it, i) => (
                <li key={`${it.date}-${i}`} className={it.key ? 'k' : ''}>
                  <time>{fmtDate(it.date)}</time>
                  <span className="badge" style={{ marginLeft: 8 }}>
                    {TL_LABEL[it.kind]}
                  </span>
                  <div style={{ fontSize: 'var(--step--1)', marginTop: 2 }}>
                    {it.href ? (
                      it.external ? (
                        <a href={it.href} target="_blank" rel="noopener noreferrer">
                          {it.label}
                        </a>
                      ) : (
                        <Link to={it.href}>{it.label}</Link>
                      )
                    ) : (
                      it.label
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {peers.length ? (
          <Section eyebrow="Peers" title={`Also in ${primary?.segment?.name ?? 'this segment'}`}>
            <div className="chips">
              {peers.map((c) => (
                <CompanyChip key={c.id} company={c} quote={c.symbol ? quotes.quotes[c.symbol] : undefined} show="ytd" view={views.get(c.id)} />
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

const TL_LABEL: Record<TimelineItem['kind'], string> = {
  view: 'View opened',
  update: 'Update',
  revision: 'Revision',
  closed: 'Closed',
  note: 'Note',
  report: 'Research',
  news: 'News',
};

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value num" style={{ fontSize: 'var(--step-1)' }}>
        {value}
      </span>
    </div>
  );
}

function PrivateBlock({ company, acquirer }: { company: Company; acquirer?: Company }) {
  const { site, quotes } = useStore();
  const proxies = (company.private?.proxies ?? []).map((id) => site.companies[id]).filter(Boolean);
  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div className="grid cols-3">
        <div className="stat">
          <span className="label">{company.listing === 'acquired' ? 'Status' : 'Last valuation'}</span>
          <span className="value" style={{ fontSize: 'var(--step-1)' }}>
            {company.listing === 'acquired' ? (
              acquirer ? (
                <>
                  Acquired by <Link to={`/company/${acquirer.id}`}>{acquirer.name}</Link>
                </>
              ) : (
                'Acquired'
              )
            ) : company.private?.valuation?.usd ? (
              fmtCompact(company.private.valuation.usd)
            ) : (
              'Undisclosed'
            )}
          </span>
          {company.private?.valuation?.round ? <span className="muted" style={{ fontSize: 'var(--step--2)' }}>{company.private.valuation.round}{company.private.valuation.date ? ` · ${company.private.valuation.date}` : ''}</span> : null}
        </div>
        <div className="stat" style={{ gridColumn: 'span 2' }}>
          <span className="label">Listed ways to get exposure</span>
          {proxies.length ? (
            <div className="chips" style={{ marginTop: 4 }}>
              {proxies.map((c) => (
                <CompanyChip key={c.id} company={c} quote={c.symbol ? quotes.quotes[c.symbol] : undefined} show="ytd" />
              ))}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
              None recorded
            </span>
          )}
        </div>
      </div>
      {company.private?.note ? (
        <p className="muted" style={{ marginTop: 10, fontSize: 'var(--step--1)' }}>
          {company.private.note}
        </p>
      ) : null}
    </div>
  );
}

function buildTimeline(
  company: Company | undefined,
  records: ReturnType<typeof recordsForCompany>,
  reports: ReturnType<typeof reportsForCompany>,
  news: ReturnType<typeof newsForCompany>,
): TimelineItem[] {
  if (!company) return [];
  const out: TimelineItem[] = [];
  for (const r of records) {
    if (isThesis(r)) {
      const t = display(r) as ThesisRecord;
      const about = t.subject?.company === company.id;
      out.push({
        date: t.createdAt,
        kind: 'view',
        label: `${about ? '' : 'Related: '}${t.direction === 'long' ? 'Long' : t.direction === 'short' ? 'Short' : 'View'} — ${t.summary}`,
        href: `/thesis/${t.id}`,
        key: about,
      });
      for (const v of t.versions ?? []) {
        if (v.at.slice(0, 10) === t.createdAt.slice(0, 10)) continue;
        out.push({ date: v.at, kind: 'revision', label: v.reason, href: `/thesis/${t.id}` });
      }
      for (const u of t.updates ?? []) out.push({ date: u.date, kind: 'update', label: u.text, href: `/thesis/${t.id}` });
      if (t.closed) out.push({ date: t.closed.date, kind: 'closed', label: t.closed.reason || 'View closed', href: `/thesis/${t.id}`, key: true });
    } else if (r.type === 'note') {
      const n = display(r);
      out.push({ date: n.createdAt, kind: 'note', label: n.title || excerptOf(n.body), href: `/notes#${n.id}` });
    }
  }
  for (const r of reports) out.push({ date: r.date, kind: 'report', label: r.title, href: `/report/${encodeURIComponent(r.id)}` });
  for (const n of news) out.push({ date: n.date, kind: 'news', label: n.title, href: n.source?.url, external: true });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function excerptOf(md: string | undefined): string {
  const s = (md ?? '').replace(/[#*_>`[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 140)}…` : s || 'Note';
}


import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Cake, type CakeStat } from '../components/Cake.tsx';
import { MarketMap, type MapColor } from '../components/MarketMap.tsx';
import { Heatmap, LayerChart } from '../components/charts.tsx';
import { CompanyChip, Change, DirectionBadge, ExampleBadge, Section, Segmented } from '../components/ui.tsx';
import { ViewCard } from '../components/ViewCard.tsx';
import { CatalystList, NewsList, useCatalysts } from '../components/lists.tsx';
import { useIndices, useSeriesMany } from '../lib/hooks.ts';
import { activeTheses, display, latestOutlook, thesisBenchmark, thesisSymbol, viewByCompany } from '../lib/views.ts';
import { fmtDate, fmtDateTime, LAYER_CODE } from '../lib/format.ts';
import type { HeatPeriod } from '../components/heat.ts';
import type { LayerId } from '../lib/types.ts';
import { industryLink } from '../lib/nodes.ts';

export default function Home() {
  const store = useStore();
  const { site, quotes, meta, allRecords, news, allReports, index, prefs, setPrefs } = store;
  const [selected, setSelected] = useState<LayerId>('chips');
  const [mapColor, setMapColor] = useState<MapColor>(prefs.mapColor);
  const [tiers, setTiers] = useState<'all' | 'core-focus'>('all');
  const mapRef = useRef<HTMLDivElement>(null);
  const indices = useIndices();

  const layerStats = useMemo(() => {
    const out: Record<string, CakeStat> = {};
    for (const l of site.layers) {
      const ids = new Set(l.industries.flatMap((i) => i.segments.flatMap((s) => s.companies)));
      const idx = indices?.series.find((s) => s.kind === 'layer' && s.id === l.id);
      let ret: number | undefined;
      if (idx && idx.v.length > 1) {
        const last = idx.d[idx.d.length - 1];
        const y0 = `${last.slice(0, 4)}-01-01`;
        let i0 = idx.d.findIndex((d) => d >= y0) - 1;
        if (i0 < 0) i0 = 0;
        ret = idx.v[idx.v.length - 1] / idx.v[i0] - 1;
      }
      out[l.id] = {
        companies: ids.size,
        ret,
        retLabel: 'YTD',
        names: l.featured.map((id) => site.companies[id]?.name).filter(Boolean) as string[],
      };
    }
    return out;
  }, [site, indices]);

  const layer = index.layerById.get(selected)!;
  const views = useMemo(() => viewByCompany(allRecords), [allRecords]);
  const outlook = useMemo(() => {
    const o = latestOutlook(allRecords);
    return o ? display(o) : undefined;
  }, [allRecords]);
  const active = useMemo(() => activeTheses(allRecords).map((t) => display(t)), [allRecords]);
  const symbols = useMemo(() => active.flatMap((t) => [thesisSymbol(t, site), thesisBenchmark(t, site)]), [active, site]);
  const seriesMap = useSeriesMany(symbols);
  const catalysts = useCatalysts(site, quotes.quotes, active, 45);
  const nodeName = (p: string) => index.nodes.get(p)?.name;
  const listed = Object.values(site.companies).filter((c) => c.listing === 'listed').length;
  const layerNames = Object.fromEntries(site.layers.map((l) => [l.id, { name: l.name, order: l.order }]));

  const exportMap = async () => {
    if (!mapRef.current) return;
    try {
      const { toPng } = await import('html-to-image');
      const url = await toPng(mapRef.current, { pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor });
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-industry-map-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch {
      store.toast('Image export is not available in this browser.', 'error');
    }
  };

  return (
    <div className="page">
      <div className="wrap">
        <div className="hero">
          <div className="min0">
            <div className="hero-title">
              <div className="eyebrow">An investor's map of the AI economy</div>
              <h1 style={{ marginTop: 8 }}>The five-layer cake, priced daily</h1>
              <p className="lede">
                Jensen Huang describes AI as a five-layer stack: energy, chips, infrastructure, models and applications. This map places{' '}
                {Object.keys(site.companies).length} companies across those layers and their value chains, tracks their prices every trading day,
                and holds the research and views behind each one.
              </p>
              <div className="hero-meta">
                <span>
                  <b>{listed}</b> listed · <b>{Object.keys(site.companies).length - listed}</b> private
                </span>
                <span>
                  <b>{site.layers.reduce((a, l) => a + l.industries.length, 0)}</b> industries
                </span>
                <span>Prices as of {meta.pricesAsOf ? <b>{fmtDate(meta.pricesAsOf)}</b> : 'the next market update'}</span>
              </div>
            </div>
            <Cake layers={site.layers} stats={layerStats} selected={selected} onSelect={setSelected} />
          </div>
          <div className="min0 stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            {outlook ? <OutlookCard /> : null}
            <div className="brief" data-layer={layer.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="code">
                  {LAYER_CODE[layer.id]} · {layer.nameZh}
                </span>
                {outlook?.layerStances?.[layer.id] ? <DirectionBadge direction={outlook.layerStances[layer.id]!.direction} /> : null}
              </div>
              <h2>{layer.name}</h2>
              <p className="tag">{layer.tagline}</p>
              <p className="muted" style={{ marginTop: 8, fontSize: 'var(--step--1)' }}>
                {layer.description}
              </p>
              <div className="brief-stats">
                <div className="stat">
                  <span className="label">Companies</span>
                  <span className="value">{layerStats[layer.id]?.companies ?? '—'}</span>
                </div>
                <div className="stat">
                  <span className="label">Basket YTD</span>
                  <span className="value">
                    <Change value={layerStats[layer.id]?.ret} />
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Industries</span>
                  <span className="value">{layer.industries.length}</span>
                </div>
              </div>
              <div className="eyebrow">Industries</div>
              <div className="chips" style={{ marginTop: 6 }}>
                {layer.industries.map((i) => (
                  <Link key={i.id} to={industryLink(i.path)} className="chip">
                    <span className="nm" style={{ color: 'var(--ink)' }}>
                      {i.name}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="eyebrow" style={{ marginTop: 14 }}>
                Bellwethers · 1D
              </div>
              <div className="chips" style={{ marginTop: 6 }}>
                {layer.featured.map((id) => {
                  const c = site.companies[id];
                  if (!c) return null;
                  return <CompanyChip key={id} company={c} quote={c.symbol ? quotes.quotes[c.symbol] : undefined} show="d1" view={views.get(id)} />;
                })}
              </div>
              <div className="eyebrow" style={{ marginTop: 14 }}>
                What to watch
              </div>
              <ul className="watch">
                {layer.watch.slice(0, 3).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <div className="row" style={{ marginTop: 16 }}>
                <Link className="btn primary" to={`/layer/${layer.id}`}>
                  Open {layer.name}
                </Link>
                <a className="btn" href="#heatmap">
                  Heatmap
                </a>
              </div>
            </div>
          </div>
        </div>

        <Section
          id="map"
          eyebrow="The map"
          title="Every layer, industry and company"
          sub="Each industry is split into upstream, midstream and downstream segments. Click any company for its page, research and views."
          tools={
            <>
              <Segmented
                label="Color companies by"
                value={mapColor}
                onChange={(v) => {
                  setMapColor(v);
                  setPrefs({ mapColor: v });
                }}
                options={[
                  { value: 'none', label: 'Plain' },
                  { value: 'd1', label: '1D' },
                  { value: 'ytd', label: 'YTD' },
                  { value: 'view', label: 'My views' },
                ]}
              />
              <Segmented
                label="Show"
                value={tiers}
                onChange={setTiers}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'core-focus', label: 'Core & focus' },
                ]}
              />
              <button type="button" className="btn sm" onClick={exportMap}>
                Save as image
              </button>
            </>
          }
        >
          <MarketMap ref={mapRef} colorBy={mapColor} views={views} tiers={tiers} />
        </Section>

        <Section
          id="heatmap"
          eyebrow="Market"
          title="Heatmap"
          sub={quotes.asOf ? `Closing prices as of ${fmtDate(quotes.asOf)}${quotes.updatedAt ? ` · updated ${fmtDateTime(quotes.updatedAt, site.config.site.timezone)}` : ''}.` : 'Market data appears after the first daily update.'}
          tools={
            <Segmented
              label="Period"
              value={prefs.heatPeriod}
              onChange={(v) => setPrefs({ heatPeriod: v })}
              options={[
                { value: 'd1', label: '1D' },
                { value: 'w1', label: '1W' },
                { value: 'm1', label: '1M' },
                { value: 'ytd', label: 'YTD' },
                { value: 'y1', label: '1Y' },
                { value: 'ai', label: 'Since 2023' },
              ]}
            />
          }
        >
          <div className="card" style={{ padding: 10 }}>
            {Object.keys(quotes.quotes).length ? (
              <Heatmap site={site} quotes={quotes.quotes} period={prefs.heatPeriod as HeatPeriod} />
            ) : (
              <div className="empty">Prices load after the first market-data run.</div>
            )}
          </div>
        </Section>

        {indices && indices.series.some((s) => s.kind === 'layer') ? (
          <Section eyebrow="Layers" title="Where the money has gone since the AI trade began" sub="Equal-weight baskets of each layer, rebased to 100.">
            <LayerChart series={indices.series} layerNames={layerNames} />
          </Section>
        ) : null}

        <Section
          eyebrow="Views"
          title="Active views"
          sub="Each view is tracked against its base price, target and benchmark."
          tools={
            <Link to="/views" className="btn sm">
              All views
            </Link>
          }
        >
          {active.length ? (
            <div className="grid cols-3">
              {active.slice(0, 6).map((t) => {
                const sym = thesisSymbol(t, site);
                const b = thesisBenchmark(t, site);
                return <ViewCard key={t.id} thesis={t} site={site} series={sym ? seriesMap.get(sym) : undefined} bench={b ? seriesMap.get(b) : undefined} nodeName={nodeName} />;
              })}
            </div>
          ) : (
            <div className="empty">No views yet.</div>
          )}
        </Section>

        <div className="grid cols-2" style={{ marginTop: 44, '--gap': '28px' } as React.CSSProperties}>
          <div className="min0">
            <div className="section-head">
              <div>
                <div className="eyebrow">Next 45 days</div>
                <h2>Catalysts</h2>
              </div>
              <Link to="/calendar" className="btn sm">
                Calendar
              </Link>
            </div>
            <div className="card">
              <CatalystList items={catalysts} limit={9} />
            </div>
          </div>
          <div className="min0">
            <div className="section-head">
              <div>
                <div className="eyebrow">Industry news</div>
                <h2>Latest</h2>
              </div>
              <Link to="/news" className="btn sm">
                All news
              </Link>
            </div>
            <div className="card">
              <NewsList items={news.slice(0, 7)} site={site} compact />
            </div>
          </div>
        </div>

        <Section
          eyebrow="Research library"
          title="Latest research"
          tools={
            <Link to="/research" className="btn sm">
              Library
            </Link>
          }
        >
          <div className="grid cols-3">
            {allReports.slice(0, 6).map((r) => (
              <Link key={r.id} to={`/report/${encodeURIComponent(r.id)}`} className="report-card">
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge">{r.kind === 'claude' ? 'Claude research' : r.broker || 'Sell-side'}</span>
                  <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
                    {fmtDate(r.date)}
                  </span>
                </div>
                <div className="rt">{r.title}</div>
                {r.titleZh ? <div className="rz">{r.titleZh}</div> : null}
                {r.summary?.en?.length ? (
                  <ul>
                    {r.summary.en.slice(0, 2).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function OutlookCard() {
  const { allRecords, site, index } = useStore();
  const o = latestOutlook(allRecords);
  if (!o) return null;
  const d = display(o);
  const node = d.bottleneck?.node ? index.nodes.get(d.bottleneck.node) : undefined;
  return (
    <div className="outlook">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">My read · {fmtDate(d.createdAt)}</span>
        {d.example ? <ExampleBadge /> : null}
      </div>
      {d.bottleneck ? (
        <div className="bottleneck" style={{ marginTop: 8 }}>
          <div className="min0">
            <div className="muted" style={{ fontSize: 'var(--step--2)' }}>
              Current bottleneck{node ? ` · ${node.layer.name}` : ''}
            </div>
            <div className="bn-label">{d.bottleneck.label}</div>
            {d.bottleneck.note ? (
              <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: 4 }}>
                {d.bottleneck.note}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {d.layerStances ? (
        <div className="stance-row" aria-label="Stance by layer">
          {site.layers
            .slice()
            .sort((a, b) => b.order - a.order)
            .map((l) => {
              const st = d.layerStances?.[l.id];
              return (
                <div key={l.id} className="stance" data-layer={l.id} title={st?.note}>
                  <b>L{l.order}</b>
                  {l.name}
                  <div className={st?.direction === 'long' ? 'up' : st?.direction === 'short' ? 'down' : 'muted'} style={{ fontWeight: 600 }}>
                    {st ? (st.direction === 'long' ? '▲ Long' : st.direction === 'short' ? '▼ Short' : st.direction === 'neutral' ? '■ Neutral' : '○ Watch') : '—'}
                  </div>
                </div>
              );
            })}
        </div>
      ) : null}
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <Link to="/journal#outlook" className="linkish" style={{ fontSize: 'var(--step--1)' }}>
          Bottleneck history
        </Link>
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { LAYER_CODE, fmtDateTime } from '../lib/format.ts';

export default function AboutPage() {
  const { site, meta, index } = useStore();
  const s = site.config.site;
  const industries = site.layers.reduce((n, l) => n + l.industries.length, 0);
  const segments = [...index.nodes.values()].filter((n) => n.kind === 'segment').length;
  const repo = `https://github.com/${site.config.repos.public.owner}/${site.config.repos.public.repo}`;
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 920 }}>
        <div className="eyebrow">About</div>
        <h1 style={{ marginTop: 4 }}>A map of the AI economy, priced daily</h1>
        <p className="lede" style={{ marginTop: 10 }}>
          {s.name} is an open research notebook on the AI build-out. It sorts the industry into the five layers NVIDIA’s Jensen Huang uses to describe AI —
          energy, chips, infrastructure, models and applications — then breaks each layer into industries, value-chain segments and the companies in them. Research,
          notes and dated, explicit views sit on top of that map, and every view is checked against market prices each trading day.
        </p>

        <div className="kpis" style={{ marginTop: 24 }}>
          <Fig label="Layers" value="5" />
          <Fig label="Industries" value={String(industries)} />
          <Fig label="Segments" value={String(segments)} />
          <Fig label="Companies" value={String(meta.counts.companies ?? Object.keys(site.companies).length)} />
          <Fig label="Listed" value={String(meta.counts.listed ?? '—')} />
          <Fig label="Reports" value={String(meta.counts.reports ?? '—')} />
        </div>

        <section className="section">
          <h2>The five layers</h2>
          <div className="stack" style={{ marginTop: 14, '--gap': '10px' } as React.CSSProperties}>
            {site.layers
              .slice()
              .sort((a, b) => b.order - a.order)
              .map((l) => (
                <Link key={l.id} to={`/layer/${l.id}`} className="layer-head" data-layer={l.id} style={{ display: 'block', padding: '14px 18px', marginBottom: 0, color: 'var(--ink)' }}>
                  <span className="code">{LAYER_CODE[l.id]}</span> <b>{l.name}</b>
                  <span className="muted"> — {l.tagline}</span>
                </Link>
              ))}
          </div>
          <p style={{ marginTop: 14, color: 'var(--ink-2)' }}>
            Each layer depends on the one below it: models need compute, compute needs data centers, data centers need power. Bottlenecks move up and down the
            stack, which is why the map keeps the layers side by side and the journal tracks where the binding constraint sits.
          </p>
        </section>

        <section className="section">
          <h2>How views are tracked</h2>
          <div className="prose" style={{ marginTop: 10 }}>
            <ul>
              <li>
                <b>Base price.</b> Each view records the price it was written against (normally the latest close), with its date. The market close on that day is stored
                too, as an objective reference.
              </li>
              <li>
                <b>Daily prices.</b> Split-adjusted daily closes from Yahoo Finance, fetched after the US close and again after the Asian close for Asian listings. A
                price entered before a stock split is divided by the split ratio so it stays comparable.
              </li>
              <li>
                <b>Returns.</b> Measured from the base price to the latest close and signed by the direction of the call, so a correct short shows a gain. Dividends are
                excluded. “vs index” subtracts the benchmark over the same days: the Nasdaq-100 for US listings, the PHLX Semiconductor index for US chip names, and the
                local market index elsewhere.
              </li>
              <li>
                <b>Industry, layer and theme views</b> are measured against an equal-weight basket of the listed companies in that node, or against an ETF if the view names
                one.
              </li>
              <li>
                <b>Closing a view.</b> The site flags when a close crosses the target or the stop, or when the horizon ends. Nothing is closed until the author confirms.
                Changes to direction, conviction, target, stop or horizon are kept as dated revisions, so the record shows what was believed and when.
              </li>
              <li>
                <b>What is public.</b> Views can be private or public. Public views hide the target, stop, scenarios, trading plan and position unless the author chooses to
                show them.
              </li>
            </ul>
          </div>
        </section>

        <section className="section">
          <h2>Research and language</h2>
          <p style={{ marginTop: 10, color: 'var(--ink-2)' }}>
            Long-form reports in the library were written with Claude (Anthropic) as a research assistant, from public sources, and show the date of their data. Many are
            bilingual; the reader opens them in English and switches to Chinese with one click. Notes and views are often drafted in Chinese and translated into English
            with Claude; the original text stays one click away. Third-party broker research is never published here.
          </p>
        </section>

        <section className="section">
          <h2>Data and caveats</h2>
          <p style={{ marginTop: 10, color: 'var(--ink-2)' }}>
            Market capitalizations are converted to US dollars at daily exchange rates. Valuations of private companies are the latest reported funding rounds and may be
            stale. Consensus targets and earnings dates come from the same market-data feed and can be wrong; estimated dates are marked. Company placements in the map are
            editorial judgments. {s.disclaimer}
          </p>
          <p className="faint" style={{ marginTop: 8, fontSize: 'var(--step--1)' }}>
            Prices as of {meta.pricesAsOf ?? '—'} · data updated {fmtDateTime(meta.dataUpdatedAt, s.timezone)} · site built {fmtDateTime(meta.generatedAt, s.timezone)}
          </p>
        </section>

        <section className="section">
          <h2>Open source</h2>
          <p style={{ marginTop: 10, color: 'var(--ink-2)' }}>
            The site is a static app. The map, company list, research index and public views are plain YAML and Markdown files in{' '}
            <a href={repo} target="_blank" rel="noopener noreferrer">
              the GitHub repository
            </a>
            , and anyone can fork it to build their own map. Maintained by{' '}
            <a href={s.ownerUrl} target="_blank" rel="noopener noreferrer">
              {s.owner}
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value num">{value}</span>
    </div>
  );
}

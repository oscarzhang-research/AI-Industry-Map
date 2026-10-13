import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { useKpis } from '../lib/hooks.ts';
import { KpiCard } from '../components/kpis.tsx';
import { LAYER_CODE, fmtDateTime } from '../lib/format.ts';

export default function IndicatorsPage() {
  const { site } = useStore();
  const kpis = useKpis();
  const layers = site.layers.slice().sort((a, b) => a.order - b.order);
  return (
    <div className="page">
      <div className="wrap">
        <div className="eyebrow">Indicators</div>
        <h1 style={{ marginTop: 4 }}>The numbers behind the build-out</h1>
        <p className="lede" style={{ marginTop: 10, maxWidth: '72ch' }}>
          Spending, sales and prices that show where demand is moving through the five layers, from utility capital spending to software revenue. Each figure comes
          from company filings, Taiwan’s monthly revenue reports or a named research firm, and updates as new reports arrive.
        </p>
        {kpis?.updatedAt ? (
          <p className="faint" style={{ marginTop: 6, fontSize: 'var(--step--1)' }}>
            Filings and monthly reports last checked {fmtDateTime(kpis.updatedAt, site.config.site.timezone)}.
          </p>
        ) : null}
        {kpis === null ? (
          <div style={{ height: 240, display: 'grid', placeItems: 'center' }}>
            <span className="spinner" />
          </div>
        ) : !kpis.indicators.length ? (
          <div className="empty" style={{ marginTop: 24 }}>
            Indicators appear after the first data run.
          </div>
        ) : (
          layers.map((l) => {
            const list = kpis.indicators.filter((k) => k.layer === l.id);
            if (!list.length) return null;
            return (
              <section key={l.id} className="section" data-layer={l.id}>
                <div className="section-head">
                  <div className="min0">
                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                      {LAYER_CODE[l.id]}
                    </div>
                    <h2>
                      <Link to={`/layer/${l.id}`} style={{ color: 'inherit' }}>
                        {l.name}
                      </Link>
                    </h2>
                  </div>
                </div>
                <div className="grid cols-2 kpi-grid">
                  {list.map((k) => (
                    <KpiCard key={k.id} kpi={k} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

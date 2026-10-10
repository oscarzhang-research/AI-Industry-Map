import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change } from '../components/ui.tsx';
import { useIndices } from '../lib/hooks.ts';
import { basketReturns } from './LayerPage.tsx';

export default function ThemesPage() {
  const { site, quotes } = useStore();
  const indices = useIndices();
  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Themes</div>
            <h1 style={{ marginTop: 4 }}>Threads that cut across the layers</h1>
            <p className="lede">Each theme gathers its companies, views, research and news, with an equal-weight basket of its listed names.</p>
          </div>
        </header>
        <div className="grid cols-3">
          {site.themes.map((t) => {
            const br = basketReturns(indices?.series.find((s) => s.kind === 'theme' && s.id === t.id));
            const movers = t.companies
              .map((id) => site.companies[id])
              .filter((c) => c?.symbol && quotes.quotes[c.symbol])
              .sort((a, b) => (quotes.quotes[b.symbol!].r.ytd ?? -9) - (quotes.quotes[a.symbol!].r.ytd ?? -9))
              .slice(0, 4);
            return (
              <Link key={t.id} to={`/theme/${t.id}`} className="view-card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b style={{ fontSize: 'var(--step-1)' }}>{t.name}</b>
                  <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
                    {t.nameZh}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
                  {t.description}
                </p>
                <div className="chips">
                  {movers.map((c) => (
                    <span key={c.id} className="chip">
                      <span className="tk">{c.symbol}</span>
                      <Change value={quotes.quotes[c.symbol!].r.ytd} className="ch" />
                    </span>
                  ))}
                </div>
                <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                  <div className="stat">
                    <span className="label">Companies</span>
                    <span className="value">{t.companies.length}</span>
                  </div>
                  <div className="stat">
                    <span className="label">Basket YTD</span>
                    <span className="value">
                      <Change value={br.ytd} />
                    </span>
                  </div>
                  <div className="stat">
                    <span className="label">1Y</span>
                    <span className="value">
                      <Change value={br.y1} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

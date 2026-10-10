import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { CompanyChip, LayerBadge, Segmented } from '../components/ui.tsx';
import { fmtDate, LAYER_CODE, plural, relativeDays, todayISO } from '../lib/format.ts';
import { theses } from '../lib/views.ts';
import type { LayerId } from '../lib/types.ts';

interface CalItem {
  date: string;
  end?: string;
  label: string;
  kind: string;
  href?: string;
  external?: boolean;
  tentative?: boolean;
  note?: string;
  location?: string;
  companies: string[];
  layer?: LayerId;
}

type Win = 'past' | '30' | '90' | '180';
type KindFilter = 'all' | 'earnings' | 'conference' | 'policy' | 'product' | 'macro' | 'view';

const KIND_LABEL: Record<string, string> = {
  earnings: 'Earnings',
  conference: 'Conference',
  policy: 'Policy',
  product: 'Product',
  macro: 'Macro',
  view: 'My catalyst',
};

export default function CalendarPage() {
  const { site, quotes, allRecords } = useStore();
  const today = todayISO(site.config.site.timezone);
  const [win, setWin] = useState<Win>('90');
  const [kind, setKind] = useState<KindFilter>('all');
  const [layer, setLayer] = useState<'all' | LayerId>('all');
  const [watchlist, setWatchlist] = useState(false);

  const items = useMemo(() => {
    const out: CalItem[] = [];
    const earnCovered = new Map<string, string[]>();
    for (const e of site.events) {
      const layerId = (e.nodes?.[0]?.split('/')[0] as LayerId | undefined) ?? (e.companies?.[0] ? site.companies[e.companies[0]]?.primaryLayer : undefined);
      out.push({
        date: e.start,
        end: e.end,
        label: e.name,
        kind: e.kind,
        href: e.url,
        external: !!e.url,
        tentative: e.tentative,
        note: e.note,
        location: e.location,
        companies: e.companies ?? [],
        layer: layerId,
      });
      if (e.kind === 'earnings') for (const c of e.companies ?? []) earnCovered.set(c, [...(earnCovered.get(c) ?? []), e.start]);
    }
    for (const c of Object.values(site.companies)) {
      if (c.listing !== 'listed' || !c.symbol) continue;
      const q = quotes.quotes[c.symbol];
      if (!q?.earn) continue;
      if ((earnCovered.get(c.id) ?? []).some((d) => Math.abs(Date.parse(d) - Date.parse(q.earn!)) < 8 * 86400000)) continue;
      out.push({
        date: q.earn,
        label: `${c.name} earnings`,
        kind: 'earnings',
        href: `/company/${c.id}`,
        tentative: q.earnEst,
        companies: [c.id],
        layer: c.primaryLayer,
        note: c.tier === 'watch' ? 'watchlist' : undefined,
      });
    }
    for (const t of theses(allRecords)) {
      if (t.status !== 'active') continue;
      for (const k of t.catalysts ?? []) {
        if (!k.date) continue;
        const co = t.subject?.company;
        out.push({
          date: k.date,
          label: k.label,
          kind: 'view',
          href: `/thesis/${t.id}`,
          note: t.title || t.summary,
          companies: co ? [co] : [],
          layer: co ? site.companies[co]?.primaryLayer : (t.subject?.node?.split('/')[0] as LayerId | undefined),
        });
      }
    }
    return out;
  }, [site, quotes, allRecords]);

  const shown = useMemo(() => {
    const lo = win === 'past' ? shift(today, -60) : today;
    const hi = win === 'past' ? shift(today, -1) : shift(today, Number(win));
    return items
      .filter((i) => (i.end ?? i.date) >= lo && i.date <= hi)
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => layer === 'all' || i.layer === layer)
      .filter((i) => watchlist || i.kind !== 'earnings' || !i.companies.length || site.companies[i.companies[0]]?.tier !== 'watch')
      .sort((a, b) => (win === 'past' ? (a.date < b.date ? 1 : -1) : a.date < b.date ? -1 : a.date > b.date ? 1 : a.label.localeCompare(b.label)));
  }, [items, win, kind, layer, watchlist, today, site.companies]);

  const weeks = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of shown) {
      const k = weekStart(i.date < today && win !== 'past' ? today : i.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()];
  }, [shown, today, win]);

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Calendar</div>
            <h1 style={{ marginTop: 4 }}>What’s coming</h1>
            <p className="lede">Earnings, conferences and policy dates across the five layers, plus the catalysts written into the views. “Estimated” dates follow last year’s timing until confirmed.</p>
          </div>
          <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
            {plural(shown.length, 'date')}
          </span>
        </header>

        <div className="row" style={{ marginBottom: 18 }}>
          <Segmented
            label="Window"
            value={win}
            onChange={setWin}
            options={[
              { value: 'past', label: 'Past 60 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '180', label: '6 months' },
            ]}
          />
          <select className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} aria-label="Kind" id="cal-kind">
            <option value="all">All kinds</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 'auto' }} value={layer} onChange={(e) => setLayer(e.target.value as 'all' | LayerId)} aria-label="Layer" id="cal-layer">
            <option value="all">All layers</option>
            {site.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {LAYER_CODE[l.id]} {l.name}
              </option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={watchlist} onChange={(e) => setWatchlist(e.target.checked)} /> Include watchlist earnings
          </label>
        </div>

        {weeks.length ? (
          <div className="stack" style={{ '--gap': '22px' } as React.CSSProperties}>
            {weeks.map(([wk, list]) => (
              <section key={wk}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>
                  Week of {fmtDate(wk)}
                </div>
                <div className="card" style={{ padding: '0 16px' }}>
                  <div className="list">
                    {list.map((i, n) => (
                      <article key={`${i.date}-${n}`} className={`list-item${i.kind === 'view' ? ' importance-3' : ''}`}>
                        <div className="when">
                          {fmtDate(i.date, false)}
                          {i.end && i.end !== i.date ? ` – ${i.end.slice(5, 7) === i.date.slice(5, 7) ? Number(i.end.slice(8, 10)) : fmtDate(i.end, false)}` : ''}
                          <div className="faint">{relativeDays(i.date, today)}</div>
                        </div>
                        <div className="min0">
                          <div className="title">
                            {i.href ? (
                              i.external ? (
                                <a href={i.href} target="_blank" rel="noopener noreferrer">
                                  {i.label}
                                </a>
                              ) : (
                                <Link to={i.href}>{i.label}</Link>
                              )
                            ) : (
                              i.label
                            )}
                          </div>
                          {i.note && i.kind !== 'earnings' ? <p className="summary">{i.note}</p> : null}
                          <div className="meta">
                            <span className="badge">{KIND_LABEL[i.kind] ?? i.kind}</span>
                            {i.layer ? <LayerBadge layer={i.layer} /> : null}
                            {i.tentative ? <span>Estimated</span> : null}
                            {i.location ? <span>{i.location}</span> : null}
                            {i.kind !== 'earnings'
                              ? i.companies.slice(0, 5).map((id) => {
                                  const c = site.companies[id];
                                  return c ? <CompanyChip key={id} company={c} withName={false} /> : null;
                                })
                              : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty">Nothing scheduled in this window.</div>
        )}
      </div>
    </div>
  );
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

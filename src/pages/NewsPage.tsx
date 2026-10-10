import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Section, Segmented } from '../components/ui.tsx';
import { NewsList } from '../components/lists.tsx';
import { newsPreset } from '../components/NodeContent.tsx';
import { fmtDate, LAYER_CODE, plural, todayISO } from '../lib/format.ts';
import type { LayerId, NewsItem } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

type Window = '7' | '30' | 'all';

export default function NewsPage() {
  const { site, news, canEdit } = useStore();
  const [layer, setLayer] = useState<'all' | LayerId>('all');
  const [industry, setIndustry] = useState<string>('all');
  const [keyOnly, setKeyOnly] = useState(false);
  const [win, setWin] = useState<Window>('30');
  const today = todayISO(site.config.site.timezone);

  const layerOf = (n: NewsItem): LayerId | undefined => (n.nodes[0]?.split('/')[0] as LayerId | undefined) ?? site.companies[n.companies[0]]?.primaryLayer;
  const inLayer = (n: NewsItem, l: LayerId) => n.nodes.some((p) => p.startsWith(`${l}`)) || n.companies.some((c) => site.companies[c]?.layers.includes(l));

  const feed = useMemo(() => {
    const since = win === 'all' ? '' : shift(today, -Number(win));
    return news
      .filter((n) => n.date >= since)
      .filter((n) => layer === 'all' || inLayer(n, layer))
      .filter((n) => industry === 'all' || n.nodes.some((p) => p.startsWith(industry)) || n.companies.some((c) => site.companies[c]?.placements.some((p) => p.startsWith(industry))))
      .filter((n) => !keyOnly || (n.importance ?? 1) >= 3)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.importance ?? 1) - (a.importance ?? 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news, layer, industry, keyOnly, win, today, site]);

  const byDay = useMemo(() => {
    const m = new Map<string, NewsItem[]>();
    for (const n of feed) {
      if (!m.has(n.date)) m.set(n.date, []);
      m.get(n.date)!.push(n);
    }
    return [...m.entries()];
  }, [feed]);

  // The brief: the most important recent items in each layer, anchored on the newest item so it never goes blank.
  const brief = useMemo(() => {
    const newest = news.reduce((m, n) => (n.date > m ? n.date : m), '');
    const since = newest ? shift(newest, -10) : '';
    return site.layers
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((l) => ({
        layer: l,
        items: news
          .filter((n) => n.date >= since && layerOf(n) === l.id)
          .sort((a, b) => (b.importance ?? 1) - (a.importance ?? 1) || (a.date < b.date ? 1 : -1))
          .slice(0, 3),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news, site]);

  const layerObj = layer === 'all' ? undefined : site.layers.find((l) => l.id === layer);
  const onSave = canEdit ? (n: NewsItem) => openEditor({ kind: 'note', preset: newsPreset(n) }) : undefined;
  const latest = news.reduce((m, n) => (n.date > m ? n.date : m), '');

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Industry news</div>
            <h1 style={{ marginTop: 4 }}>What moved the stack</h1>
            <p className="lede">
              Recent, sourced items from company releases, regulators and major outlets, tagged by layer and industry. Key items carry a dot.
              {canEdit ? ' “Save as note” turns an item into a note with the source attached.' : ''}
            </p>
          </div>
          <div className="muted" style={{ fontSize: 'var(--step--2)', textAlign: 'right' }}>
            {plural(news.length, 'item')}
            {latest ? ` · latest ${fmtDate(latest)}` : ''}
          </div>
        </header>

        <Section eyebrow="Brief" title="By layer" sub="The most important items of the last ten days in each layer.">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {brief.map(({ layer: l, items }) => (
              <div key={l.id} className="card" data-layer={l.id} style={{ borderTop: '3px solid var(--layer-line)' }}>
                <Link to={`/layer/${l.id}`} className="eyebrow" style={{ color: 'var(--layer-ink)' }}>
                  {LAYER_CODE[l.id]} {l.name}
                </Link>
                {items.length ? (
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                    {items.map((n) => (
                      <li key={n.id} style={{ fontSize: 'var(--step--1)', lineHeight: 1.4 }}>
                        <Link to={`#${n.id}`} style={{ color: 'var(--ink)' }}>
                          {n.title}
                        </Link>
                        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
                          {fmtDate(n.date, false)} · {n.source?.name}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ fontSize: 'var(--step--1)', marginTop: 8 }}>
                    Quiet.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Feed" title={`${plural(feed.length, 'item')}`}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Segmented
              label="Layer"
              value={layer}
              onChange={(v) => {
                setLayer(v);
                setIndustry('all');
              }}
              options={[{ value: 'all' as const, label: 'All' }, ...site.layers.map((l) => ({ value: l.id, label: LAYER_CODE[l.id] }))]}
            />
            {layerObj ? (
              <select className="select" style={{ width: 'auto' }} value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry" id="news-industry">
                <option value="all">All of {layerObj.name}</option>
                {layerObj.industries.map((i) => (
                  <option key={i.id} value={i.path}>
                    {i.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Segmented
              label="Window"
              value={win}
              onChange={setWin}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: 'all', label: 'All' },
              ]}
            />
            <label className="checkbox">
              <input type="checkbox" checked={keyOnly} onChange={(e) => setKeyOnly(e.target.checked)} /> Key items only
            </label>
          </div>
          {byDay.length ? (
            <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    {weekday(day)} · {fmtDate(day)}
                  </div>
                  <div className="card">
                    <NewsList items={items} site={site} onSaveNote={onSave} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Nothing in this window. Try “All”.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(iso: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

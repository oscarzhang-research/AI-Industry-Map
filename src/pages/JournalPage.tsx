import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { DirectionBadge, ExampleBadge, PrivateBadge, Section, Segmented } from '../components/ui.tsx';
import { renderMarkdown } from '../lib/markdown.ts';
import { recordLanguage, translationState } from '../lib/records.ts';
import { display, isJournal, isOutlook } from '../lib/views.ts';
import { industryLink } from '../lib/nodes.ts';
import { fmtDate, LAYER_CODE } from '../lib/format.ts';
import type { JournalRecord, OutlookRecord } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

type PeriodFilter = 'all' | JournalRecord['period']['kind'];
const PERIOD_LABEL: Record<JournalRecord['period']['kind'], string> = { week: 'Weekly', fortnight: 'Fortnightly', month: 'Monthly', quarter: 'Quarterly' };

export default function JournalPage() {
  const { allRecords, canEdit } = useStore();
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const entries = useMemo(
    () =>
      allRecords
        .filter(isJournal)
        .filter((j) => period === 'all' || j.period?.kind === period)
        .sort((a, b) => ((a.period?.end ?? a.createdAt) < (b.period?.end ?? b.createdAt) ? 1 : -1)),
    [allRecords, period],
  );
  const outlooks = useMemo(() => allRecords.filter(isOutlook).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [allRecords]);

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Journal</div>
            <h1 style={{ marginTop: 4 }}>Reviews and outlook</h1>
            <p className="lede">Periodic write-ups on what changed across the stack, and a running read on where the binding constraint sits.</p>
          </div>
          {canEdit ? (
            <div className="row">
              <button type="button" className="btn" onClick={() => openEditor({ kind: 'outlook' })}>
                Update outlook
              </button>
              <button type="button" className="btn primary" onClick={() => openEditor({ kind: 'journal' })}>
                New entry
              </button>
            </div>
          ) : null}
        </header>

        <Outlook outlooks={outlooks} />

        <Section
          eyebrow="Entries"
          title="Reviews"
          tools={
            <Segmented
              label="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'all', label: 'All' },
                { value: 'week', label: 'Weekly' },
                { value: 'fortnight', label: 'Fortnightly' },
                { value: 'month', label: 'Monthly' },
              ]}
            />
          }
        >
          {entries.length ? (
            <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
              {entries.map((j) => (
                <Entry key={j.id} entry={j} />
              ))}
            </div>
          ) : (
            <div className="empty">No entries yet.{canEdit ? ' Use “New entry” for a weekly or monthly review.' : ''}</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Outlook({ outlooks }: { outlooks: OutlookRecord[] }) {
  const { site, index, canEdit } = useStore();
  const [orig, setOrig] = useState(false);
  const latest = outlooks[0];
  if (!latest) {
    return (
      <Section id="outlook" eyebrow="Outlook" title="Where the bottleneck sits">
        <div className="empty">No outlook written yet.{canEdit ? ' Use “Update outlook”.' : ''}</div>
      </Section>
    );
  }
  const o = orig ? latest : display(latest);
  const isZh = recordLanguage(latest) === 'zh';
  const tr = translationState(latest);
  const history = [
    ...(o.history ?? []),
    ...outlooks.slice(1).map((x) => {
      const d = display(x);
      return d.bottleneck ? { date: d.createdAt.slice(0, 10), node: d.bottleneck.node, label: d.bottleneck.label, note: d.bottleneck.note } : null;
    }),
  ]
    .filter((h): h is NonNullable<typeof h> => !!h)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const bn = o.bottleneck ? index.nodes.get(o.bottleneck.node) : undefined;

  return (
    <Section
      id="outlook"
      eyebrow={`Outlook · ${fmtDate(o.updatedAt ?? o.createdAt)}`}
      title="Where the bottleneck sits"
      tools={
        <div className="row">
          {o.example ? <ExampleBadge /> : null}
          {o.visibility === 'private' ? <PrivateBadge /> : null}
          {isZh && tr === 'translated' ? (
            <button type="button" className="btn sm ghost" onClick={() => setOrig((v) => !v)}>
              {orig ? 'English' : '中文原文'}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn sm" onClick={() => openEditor({ kind: 'outlook', id: latest.id })}>
              Edit
            </button>
          ) : null}
        </div>
      }
    >
      <div className="grid cols-2" style={{ '--gap': '18px' } as React.CSSProperties}>
        <div className="stack min0">
          {o.bottleneck ? (
            <div className="card" data-layer={bn?.layer.id} style={{ borderLeft: '4px solid var(--layer-line, var(--accent))' }}>
              <div className="eyebrow">Current bottleneck</div>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)', lineHeight: 1.15, marginTop: 6 }}>{o.bottleneck.label}</p>
              {bn ? (
                <Link to={industryLink(bn.path)} style={{ fontSize: 'var(--step--1)' }}>
                  {LAYER_CODE[bn.layer.id]} {bn.layer.name} · {bn.kind === 'segment' ? `${bn.industry?.name} · ${bn.name}` : bn.name}
                </Link>
              ) : null}
              {o.bottleneck.note ? <div className="prose" style={{ marginTop: 8, fontSize: 'var(--step--1)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(o.bottleneck.note) }} /> : null}
            </div>
          ) : null}
          {o.cycleView ? (
            <div className="card">
              <div className="eyebrow">Cycle view</div>
              <div className="prose" style={{ marginTop: 6, fontSize: 'var(--step--1)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(o.cycleView) }} />
            </div>
          ) : null}
          {o.body ? <div className="prose" style={{ fontSize: 'var(--step--1)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(o.body) }} /> : null}
        </div>
        <div className="stack min0">
          <div className="card" style={{ padding: 0 }}>
            <div className="eyebrow" style={{ padding: '12px 14px 0' }}>
              Layer stances
            </div>
            <div className="list" style={{ padding: '0 14px 6px' }}>
              {site.layers
                .slice()
                .sort((a, b) => b.order - a.order)
                .map((l) => {
                  const st = o.layerStances?.[l.id];
                  return (
                    <div key={l.id} className="stance-line" data-layer={l.id}>
                      <Link to={`/layer/${l.id}`} className="stance-name">
                        <span className="code">{LAYER_CODE[l.id]}</span> {l.name}
                      </Link>
                      <span>{st ? <DirectionBadge direction={st.direction} /> : <span className="faint">—</span>}</span>
                      <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
                        {st?.note ?? ''}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
          {history.length ? (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                How the call has moved
              </div>
              <ol className="timeline">
                {history.map((h, i) => {
                  const n = index.nodes.get(h.node);
                  return (
                    <li key={`${h.date}-${i}`}>
                      <time>{fmtDate(h.date)}</time>
                      <div style={{ fontSize: 'var(--step--1)' }}>
                        <b>{h.label}</b>
                        {n ? (
                          <>
                            {' '}
                            · <Link to={industryLink(n.path)}>{n.name}</Link>
                          </>
                        ) : null}
                        {h.note ? <div className="muted">{h.note}</div> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function Entry({ entry }: { entry: JournalRecord }) {
  const { allRecords, canEdit } = useStore();
  const [orig, setOrig] = useState(false);
  const isZh = recordLanguage(entry) === 'zh';
  const tr = translationState(entry);
  const j = orig ? entry : display(entry);
  const linked = (j.links ?? []).map((id) => allRecords.find((r) => r.id === id)).filter(Boolean);
  return (
    <article className="card" id={entry.id}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          {j.period ? <span className="badge">{PERIOD_LABEL[j.period.kind]}</span> : null}
          <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
            {j.period ? `${fmtDate(j.period.start, j.period.start.slice(0, 4) !== j.period.end.slice(0, 4))} – ${fmtDate(j.period.end)}` : fmtDate(j.createdAt)}
          </span>
          {j.example ? <ExampleBadge /> : null}
          {j.visibility === 'private' ? <PrivateBadge /> : null}
          {j.tags?.includes('draft') ? (
            <span className="badge earn" title="Prepared automatically with the week's numbers; add your read and remove the draft tag">
              {j.tags.includes('fact-pack') ? 'Fact pack · draft' : 'Draft'}
            </span>
          ) : null}
          {isZh && (tr === 'pending' || tr === 'stale') ? <span className="badge">EN pending</span> : null}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {isZh && tr === 'translated' ? (
            <button type="button" className="btn sm ghost" onClick={() => setOrig((v) => !v)}>
              {orig ? 'English' : '中文原文'}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn sm ghost" onClick={() => openEditor({ kind: 'journal', id: entry.id })}>
              Edit
            </button>
          ) : null}
        </div>
      </div>
      {j.title ? <h3 style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 'var(--step-2)' }}>{j.title}</h3> : null}
      <div className="prose" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(j.body) }} />
      {linked.length ? (
        <div className="chips" style={{ marginTop: 12 }}>
          {linked.map((r) =>
            r ? (
              <Link key={r.id} className="chip" to={r.type === 'thesis' ? `/thesis/${r.id}` : r.type === 'note' ? `/notes#${r.id}` : `/journal#${r.id}`}>
                <span className="nm">{r.title || (r.type === 'thesis' ? r.summary : r.id)}</span>
              </Link>
            ) : null,
          )}
        </div>
      ) : null}
    </article>
  );
}

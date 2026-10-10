// Views, research, news and notes that belong to a layer, industry, company or theme.
import { useMemo } from 'react';
import type { AnyRecord, NewsItem, NoteRecord, ReportMeta, ThesisRecord } from '../lib/types.ts';
import { useStore } from '../lib/store.tsx';
import { ViewCard } from './ViewCard.tsx';
import { NewsList, ReportList } from './lists.tsx';
import { Section } from './ui.tsx';
import { display } from '../lib/views.ts';
import { useThesisSeries } from '../lib/useThesis.ts';
import { NoteItem } from './NoteItem.tsx';
import { openEditor } from '../App.tsx';

export function NodeContent({
  theses,
  notes,
  reports,
  news,
  addPreset,
  scopeLabel,
}: {
  theses: ThesisRecord[];
  notes: NoteRecord[];
  reports: ReportMeta[];
  news: NewsItem[];
  addPreset?: Record<string, unknown>;
  scopeLabel: string;
}) {
  const { site, canEdit, index } = useStore();
  const shown = useMemo(() => theses.map((t) => display(t)), [theses]);
  const seriesOf = useThesisSeries(shown, site);
  const nodeName = (p: string) => index.nodes.get(p)?.name;
  return (
    <>
      <Section
        id="views"
        eyebrow="Views"
        title={`Views on ${scopeLabel}`}
        tools={
          canEdit ? (
            <button type="button" className="btn sm primary" onClick={() => openEditor({ kind: 'thesis', preset: addPreset })}>
              New view
            </button>
          ) : undefined
        }
      >
        {shown.length ? (
          <div className="grid cols-3">
            {shown.map((t) => {
              const { series, bench } = seriesOf(t);
              return <ViewCard key={t.id} thesis={t} site={site} series={series} bench={bench} nodeName={nodeName} />;
            })}
          </div>
        ) : (
          <div className="empty">No views here yet.{canEdit ? ' Use “New view” to write one.' : ''}</div>
        )}
      </Section>
      <Section id="research" eyebrow="Research library" title="Research" sub="Pinned and most recent first; older reports fold away.">
        <ReportList reports={reports} site={site} shown={site.config.defaults.reportsShownCollapsed} />
      </Section>
      <div className="grid cols-2" style={{ marginTop: 44, '--gap': '28px' } as React.CSSProperties}>
        <div className="min0" id="news">
          <div className="section-head">
            <h2>Industry news</h2>
          </div>
          <div className="card">
            <NewsList items={news.slice(0, 12)} site={site} onSaveNote={canEdit ? (n) => openEditor({ kind: 'note', preset: newsPreset(n) }) : undefined} />
          </div>
        </div>
        <div className="min0" id="notes">
          <div className="section-head">
            <h2>Notes</h2>
            {canEdit ? (
              <button type="button" className="btn sm" onClick={() => openEditor({ kind: 'note', preset: addPreset })}>
                Add note
              </button>
            ) : null}
          </div>
          {notes.length ? (
            <div className="stack">
              {notes.slice(0, 10).map((n) => (
                <NoteItem key={n.id} note={n} />
              ))}
            </div>
          ) : (
            <div className="empty">No notes here yet.</div>
          )}
        </div>
      </div>
    </>
  );
}

export function newsPreset(n: NewsItem): Record<string, unknown> {
  return {
    title: n.title,
    body: `${n.summary ?? ''}\n\nSource: [${n.source?.name ?? 'link'}](${n.source?.url ?? ''})\n\nMy take: `,
    subjects: [...n.companies.map((c) => ({ kind: 'company', company: c })), ...n.nodes.slice(0, 1).map((p) => ({ kind: 'node', node: p }))],
    source: { kind: 'news', url: n.source?.url, newsId: n.id, label: n.source?.name },
    tags: n.themes ?? [],
  };
}

export function splitRecords(records: AnyRecord[]): { theses: ThesisRecord[]; notes: NoteRecord[] } {
  return {
    theses: records.filter((r): r is ThesisRecord => r.type === 'thesis'),
    notes: records.filter((r): r is NoteRecord => r.type === 'note'),
  };
}

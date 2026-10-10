import { useMemo, useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { NoteItem } from '../components/NoteItem.tsx';
import { isNote } from '../lib/views.ts';
import { fmtMonth, LAYER_CODE, plural } from '../lib/format.ts';
import { translatableFields } from '../lib/records.ts';
import type { LayerId, NoteRecord } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

type Src = 'all' | 'news' | 'report' | 'other';

export default function NotesPage() {
  const { site, allRecords, canEdit } = useStore();
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState<'all' | LayerId>('all');
  const [src, setSrc] = useState<Src>('all');

  const notes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allRecords
      .filter(isNote)
      .filter((n) => layer === 'all' || noteLayers(n, site.companies).includes(layer))
      .filter((n) => src === 'all' || (src === 'other' ? !n.source?.kind || !['news', 'report'].includes(n.source.kind) : n.source?.kind === src))
      .filter((n) => {
        if (!needle) return true;
        const text = [
          ...Object.values(translatableFields(n)),
          ...Object.values(n.translation?.fields ?? {}),
          ...(n.tags ?? []),
          ...(n.subjects ?? []).flatMap((s) => (s.company ? [site.companies[s.company]?.name, site.companies[s.company]?.symbol] : [s.node, s.theme])),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(needle);
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [allRecords, q, layer, src, site.companies]);

  const months = useMemo(() => {
    const m = new Map<string, NoteRecord[]>();
    for (const n of notes) {
      const k = n.createdAt.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return [...m.entries()];
  }, [notes]);

  return (
    <div className="page">
      <div className="wrap">
        <header className="page-head">
          <div className="min0">
            <div className="eyebrow">Notes</div>
            <h1 style={{ marginTop: 4 }}>Notebook</h1>
            <p className="lede">Short notes from news, research and calls: the raw material behind the views. Notes written in Chinese show an English translation, with the original one click away.</p>
          </div>
          {canEdit ? (
            <button type="button" className="btn primary" onClick={() => openEditor({ kind: 'note' })}>
              New note
            </button>
          ) : null}
        </header>

        <div className="row" style={{ marginBottom: 18 }}>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" id="notes-search" />
          <select className="select" style={{ width: 'auto' }} value={layer} onChange={(e) => setLayer(e.target.value as 'all' | LayerId)} aria-label="Layer" id="notes-layer">
            <option value="all">All layers</option>
            {site.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {LAYER_CODE[l.id]} {l.name}
              </option>
            ))}
          </select>
          <Segmented
            label="Source"
            value={src}
            onChange={setSrc}
            options={[
              { value: 'all', label: 'All' },
              { value: 'news', label: 'From news' },
              { value: 'report', label: 'From research' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
            {plural(notes.length, 'note')}
          </span>
        </div>

        {months.length ? (
          <div className="stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            {months.map(([m, list]) => (
              <section key={m}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  {fmtMonth(m)}
                </div>
                <div className="grid cols-2">
                  {list.map((n) => (
                    <NoteItem key={n.id} note={n} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty">No notes match.{canEdit ? ' Use “New note”, or “Save as note” on any news item.' : ''}</div>
        )}
      </div>
    </div>
  );
}

function noteLayers(n: NoteRecord, companies: Record<string, { layers: LayerId[] }>): LayerId[] {
  const out = new Set<LayerId>();
  for (const s of n.subjects ?? []) {
    if (s.company) for (const l of companies[s.company]?.layers ?? []) out.add(l);
    if (s.node) out.add(s.node.split('/')[0] as LayerId);
  }
  return [...out];
}

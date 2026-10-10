import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NoteRecord } from '../lib/types.ts';
import { useStore } from '../lib/store.tsx';
import { renderMarkdown } from '../lib/markdown.ts';
import { fmtDate } from '../lib/format.ts';
import { recordLanguage, translationState, withTranslation } from '../lib/records.ts';
import { CompanyChip, ExampleBadge, PrivateBadge } from './ui.tsx';
import { openEditor } from '../App.tsx';

export function NoteItem({ note }: { note: NoteRecord }) {
  const { site, canEdit, index } = useStore();
  const [orig, setOrig] = useState(false);
  const isZh = recordLanguage(note) === 'zh';
  const tr = translationState(note);
  const n = orig ? note : withTranslation(note);
  return (
    <article className="card flat" id={note.id}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
            {fmtDate(note.createdAt)}
          </span>
          {note.example ? <ExampleBadge /> : null}
          {note.visibility === 'private' ? <PrivateBadge /> : null}
          {isZh && (tr === 'pending' || tr === 'stale') ? <span className="badge" title="Written in Chinese; the English translation is queued">EN pending</span> : null}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {isZh && tr === 'translated' ? (
            <button type="button" className="btn sm ghost" onClick={() => setOrig((v) => !v)}>
              {orig ? 'English' : '中文原文'}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn sm ghost" onClick={() => openEditor({ kind: 'note', id: note.id })}>
              Edit
            </button>
          ) : null}
        </div>
      </div>
      {n.title ? <h3 style={{ marginTop: 6 }}>{n.title}</h3> : null}
      <div className="prose" style={{ marginTop: 6, fontSize: 'var(--step--1)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
      <div className="chips" style={{ marginTop: 10 }}>
        {note.subjects?.map((s, i) => {
          if (s.kind === 'company' && s.company && site.companies[s.company]) return <CompanyChip key={i} company={site.companies[s.company]} withName={false} />;
          if (s.kind === 'node' && s.node && index.nodes.get(s.node)) {
            const info = index.nodes.get(s.node)!;
            return (
              <Link key={i} className="chip" to={info.kind === 'layer' ? `/layer/${info.layer.id}` : `/industry/${info.layer.id}/${info.industry!.id}`}>
                <span className="nm">{info.name}</span>
              </Link>
            );
          }
          return null;
        })}
        {note.source?.url ? (
          <a className="chip" href={note.source.url} target="_blank" rel="noopener noreferrer">
            <span className="nm">Source: {note.source.label || 'link'}</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}

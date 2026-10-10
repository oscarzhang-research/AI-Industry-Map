import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type MiniSearch from 'minisearch';
import { useStore } from '../lib/store.tsx';
import { addReportText, buildDocs, buildIndex, type SearchDoc } from '../lib/search.ts';
import { loadReportText } from '../lib/data.ts';

const KIND_LABEL: Record<SearchDoc['kind'], string> = {
  company: 'Company',
  layer: 'Layer',
  industry: 'Industry',
  segment: 'Segment',
  thesis: 'View',
  note: 'Note',
  journal: 'Journal',
  report: 'Research',
  news: 'News',
  theme: 'Theme',
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { site, allRecords, allReports, news } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const docs = useMemo(() => buildDocs(site, allRecords, allReports, news), [site, allRecords, allReports, news]);
  const [ms, setMs] = useState<MiniSearch<SearchDoc> | null>(null);

  useEffect(() => {
    const index = buildIndex(docs);
    setMs(index);
    let alive = true;
    loadReportText().then((text) => {
      if (!alive) return;
      addReportText(index, docs, text);
      setMs(index);
    });
    return () => {
      alive = false;
    };
  }, [docs]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!ms) return [];
    if (!q.trim()) {
      return docs.filter((d) => d.kind === 'layer').map((d) => ({ ...d, score: 0 }));
    }
    return ms.search(q).slice(0, 14) as unknown as (SearchDoc & { score: number })[];
  }, [ms, q, docs]);

  useEffect(() => setSel(0), [q]);

  const go = (d: SearchDoc) => {
    navigate(d.href);
    onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={inputRef}
          id="palette-input"
          placeholder="Search companies, tickers, industries, views, research… (中文也可以)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            }
            if (e.key === 'Enter' && results[sel]) go(results[sel]);
          }}
        />
        <ul role="listbox">
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)}>
              <a
                href={`#${r.href}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(r);
                }}
              >
                <span className="kind">{KIND_LABEL[r.kind]}</span>
                <span className="min0" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.title}
                </span>
                {r.sub ? <span className="hit-sub">{r.sub}</span> : null}
              </a>
            </li>
          ))}
          {q && !results.length ? <li className="muted" style={{ padding: 12 }}>No matches. Try a ticker (NVDA), a name or a Chinese name.</li> : null}
        </ul>
      </div>
    </>
  );
}

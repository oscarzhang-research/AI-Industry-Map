// Form building blocks shared by the editors.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store.tsx';
import type { Company, SiteData } from '../lib/types.ts';
import { LAYER_CODE } from '../lib/format.ts';

export function Field({ label, hint, children, className = '', htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Section({ title, sub, open = false, children }: { title: string; sub?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="editor-section" open={open}>
      <summary>
        {title} {sub ? <span className="muted">· {sub}</span> : null}
      </summary>
      <div style={{ marginTop: 14 }}>{children}</div>
    </details>
  );
}

function matchCompanies(site: SiteData, q: string, limit = 8): Company[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored: [number, Company][] = [];
  for (const c of Object.values(site.companies)) {
    const sym = c.symbol?.toLowerCase() ?? '';
    const name = c.name.toLowerCase();
    let s = 0;
    if (sym === needle || c.id === needle) s = 100;
    else if (sym.startsWith(needle)) s = 80;
    else if (name.startsWith(needle)) s = 70;
    else if (name.includes(needle)) s = 50;
    else if (c.nameZh?.includes(q.trim())) s = 60;
    else if (c.aliases?.some((a) => a.toLowerCase().includes(needle))) s = 40;
    else if (c.tickers.some((t) => t.symbol.toLowerCase().startsWith(needle))) s = 45;
    if (s) scored.push([s + (c.tier === 'core' ? 3 : c.tier === 'focus' ? 1 : 0), c]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, c]) => c);
}

/** Type-ahead company picker (name, ticker, Chinese name or alias). */
export function CompanyPicker({ value, onChange, placeholder = 'Company or ticker', id }: { value?: string; onChange: (id: string | undefined) => void; placeholder?: string; id?: string }) {
  const { site } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => matchCompanies(site, q), [site, q]);
  const current = value ? site.companies[value] : undefined;
  if (current && !open) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="chip">
          <span className="tk">{current.symbol ?? (current.listing === 'private' ? 'Private' : 'Acq.')}</span>
          <span className="nm">{current.name}</span>
        </span>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setQ('');
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }
  const pick = (c: Company) => {
    onChange(c.id);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="combo" ref={box}>
      <input
        id={id}
        className="input"
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(hits.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter' && hits[sel]) {
            e.preventDefault();
            pick(hits[sel]);
          } else if (e.key === 'Escape' && current) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-autocomplete="list"
      />
      {open && hits.length ? (
        <ul className="combo-list" role="listbox">
          {hits.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} onMouseEnter={() => setSel(i)}>
                <span className="tk">{c.symbol ?? (c.listing === 'private' ? 'Private' : 'Acq.')}</span>
                <span className="min0">{c.name}</span>
                <span className="faint">{c.nameZh && c.nameZh !== c.name ? c.nameZh : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Several companies as removable chips plus a picker. */
export function CompanyMulti({ value, onChange, id }: { value: string[]; onChange: (ids: string[]) => void; id?: string }) {
  const { site } = useStore();
  const [key, setKey] = useState(0);
  return (
    <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
      {value.length ? (
        <div className="chips">
          {value.map((cid) => {
            const c = site.companies[cid];
            return (
              <span key={cid} className="chip">
                <span className="tk">{c?.symbol ?? 'Private'}</span>
                <span className="nm">{c?.name ?? cid}</span>
                <button type="button" className="x" aria-label={`Remove ${c?.name ?? cid}`} onClick={() => onChange(value.filter((x) => x !== cid))}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <CompanyPicker
        key={key}
        id={id}
        placeholder="Add a company"
        onChange={(cid) => {
          if (cid && !value.includes(cid)) onChange([...value, cid]);
          setKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** Select of layers, industries and segments, indented by depth. */
export function NodeSelect({ value, onChange, allowEmpty = true, id, emptyLabel = 'None' }: { value?: string; onChange: (p: string | undefined) => void; allowEmpty?: boolean; id?: string; emptyLabel?: string }) {
  const { site } = useStore();
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {site.layers
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((l) => (
          <optgroup key={l.id} label={`${LAYER_CODE[l.id]} ${l.name}`}>
            <option value={l.id}>{`${l.name} (whole layer)`}</option>
            {l.industries.map((ind) => [
              <option key={ind.path} value={ind.path}>
                {`  ${ind.name}`}
              </option>,
              ...ind.segments
                .filter((s) => !s.ref)
                .map((s) => (
                  <option key={s.path} value={s.path}>
                    {`      ${s.name}`}
                  </option>
                )),
            ])}
          </optgroup>
        ))}
    </select>
  );
}

export function NodeMulti({ value, onChange, id }: { value: string[]; onChange: (paths: string[]) => void; id?: string }) {
  const { index } = useStore();
  return (
    <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
      {value.length ? (
        <div className="chips">
          {value.map((p) => {
            const n = index.nodes.get(p);
            return (
              <span key={p} className="chip">
                <span className="nm">{n ? (n.kind === 'segment' ? `${n.industry?.name} · ${n.name}` : n.name) : p}</span>
                <button type="button" className="x" aria-label="Remove" onClick={() => onChange(value.filter((x) => x !== p))}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <NodeSelect
        id={id}
        value=""
        emptyLabel="Add an industry or segment…"
        onChange={(p) => {
          if (p && !value.includes(p)) onChange([...value, p]);
        }}
      />
    </div>
  );
}

/** Comma- or Enter-separated tags, with theme ids suggested. */
export function TagInput({ value, onChange, id }: { value: string[]; onChange: (tags: string[]) => void; id?: string }) {
  const { site } = useStore();
  const [q, setQ] = useState('');
  const add = (raw: string) => {
    const tags = raw
      .split(/[,，\s]+/)
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setQ('');
  };
  const suggestions = site.themes.filter((t) => !value.includes(t.id) && (!q || t.id.includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return (
    <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
      <div className="chips">
        {value.map((t) => (
          <span key={t} className="chip">
            <span className="nm">#{t}</span>
            <button type="button" className="x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="input"
          style={{ width: 160, minHeight: 28, padding: '3px 8px' }}
          value={q}
          placeholder="Add tag"
          onChange={(e) => {
            const v = e.target.value;
            if (/[,，]$/.test(v)) add(v);
            else setQ(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(q);
            }
          }}
          onBlur={() => q && add(q)}
        />
      </div>
      {suggestions.length ? (
        <div className="row" style={{ gap: 4 }}>
          <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
            Themes:
          </span>
          {suggestions.map((t) => (
            <button key={t.id} type="button" className="btn sm ghost" style={{ padding: '1px 6px' }} onClick={() => onChange([...value, t.id])}>
              {t.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Editable list of rows with add/remove; the row renderer gets the item and an updater. */
export function ListEditor<T>({
  items,
  onChange,
  render,
  make,
  addLabel,
  empty,
  cols,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, set: (patch: Partial<T>) => void, i: number) => ReactNode;
  make: () => T;
  addLabel: string;
  empty?: string;
  cols?: string; // grid-template-columns for a row, remove button included
}) {
  return (
    <div className="list-editor">
      {items.length ? null : empty ? (
        <p className="faint" style={{ fontSize: 'var(--step--2)', marginBottom: 6 }}>
          {empty}
        </p>
      ) : null}
      {items.map((it, i) => (
        <div key={i} className="row-item" style={cols ? { gridTemplateColumns: cols } : undefined}>
          {render(it, (patch) => onChange(items.map((x, k) => (k === i ? { ...x, ...patch } : x))), i)}
          <button type="button" className="btn sm ghost" aria-label="Remove row" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...items, make()])}>
        + {addLabel}
      </button>
    </div>
  );
}

export function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 7);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

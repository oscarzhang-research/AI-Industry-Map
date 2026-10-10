// Small shared UI pieces: change figures, badges, company chips, conviction meter, sections.
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Company, Direction, LayerId, Quote } from '../lib/types.ts';
import { dirClass, fmtPct, DIRECTION_LABEL, LAYER_CODE } from '../lib/format.ts';

export function Change({ value, digits = 1, className = '' }: { value?: number | null; digits?: 0 | 1; className?: string }) {
  return <span className={`num ${dirClass(value)} ${className}`}>{fmtPct(value, digits)}</span>;
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  const icon = direction === 'long' ? '▲' : direction === 'short' ? '▼' : direction === 'neutral' ? '■' : '○';
  return (
    <span className={`badge ${direction}`}>
      <span aria-hidden="true">{icon}</span>
      {DIRECTION_LABEL[direction]}
    </span>
  );
}

export function Conviction({ value, max = 5 }: { value?: number; max?: number }) {
  if (!value) return null;
  return (
    <span className="conviction" title={`Conviction ${value} of ${max}`} aria-label={`Conviction ${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  );
}

export function LayerBadge({ layer, name }: { layer: LayerId; name?: string }) {
  return (
    <span className="badge layer" data-layer={layer}>
      {LAYER_CODE[layer]}
      {name ? ` ${name}` : ''}
    </span>
  );
}

export function ExampleBadge() {
  return (
    <span className="badge example" title="Placeholder content for the preview. Not the author's view.">
      Example
    </span>
  );
}

export function PrivateBadge() {
  return (
    <span className="badge private" title="Only you can see this">
      <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M5 7V5a3 3 0 1 1 6 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
      </svg>
      Private
    </span>
  );
}

/** Compact company chip used on the map, in lists and in tooltips. */
export function CompanyChip({
  company,
  quote,
  show = 'none',
  view,
  withName = true,
}: {
  company: Company;
  quote?: Quote;
  show?: 'none' | 'd1' | 'ytd' | 'w1' | 'm1' | 'y1' | 'ai';
  view?: Direction;
  withName?: boolean;
}) {
  const ticker = company.listing === 'listed' ? company.symbol : company.listing === 'private' ? 'Private' : 'Acq.';
  const change = show !== 'none' ? quote?.r[show] : undefined;
  // Without a ticker the bare chip would just say "Private": show the name instead.
  if (!withName && company.listing !== 'listed') withName = true;
  return (
    <Link
      to={`/company/${company.id}`}
      className={`chip${company.listing !== 'listed' ? ' private' : ''}`}
      title={`${company.name}${company.nameZh ? ` · ${company.nameZh}` : ''}${company.symbol ? ` · ${company.symbol}` : ''}`}
    >
      <span className="tk">{ticker}</span>
      {withName ? <span className="nm">{company.name}</span> : null}
      {change !== undefined ? <Change value={change} className="ch" /> : null}
      {view && (view === 'long' || view === 'short') ? (
        <span className={`view ${view === 'long' ? 'up' : 'down'}`} aria-label={view === 'long' ? 'My view: long' : 'My view: short'}>
          {view === 'long' ? '▲' : '▼'}
        </span>
      ) : null}
    </Link>
  );
}

export function Section({
  title,
  sub,
  tools,
  children,
  id,
  eyebrow,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  id?: string;
  eyebrow?: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="section-head">
        <div className="min0">
          {eyebrow ? <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div> : null}
          <h2>{title}</h2>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
        {tools ? <div className="tools">{tools}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="row" style={{ gap: 6 }}>
          {i > 0 ? <span className="sep">/</span> : null}
          {it.to ? <Link to={it.to}>{it.label}</Link> : <span>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export type StatusKind = 'pending' | 'confirmed' | 'partial' | 'falsified' | 'watching' | 'triggered' | 'cleared' | 'upcoming' | 'happened' | 'missed';

/** Small status mark for signals, risks and catalysts (drawn, so it never depends on font glyphs). */
export function StatusIcon({ kind, label }: { kind: StatusKind; label: string }) {
  const good = kind === 'confirmed' || kind === 'cleared' || kind === 'happened';
  const bad = kind === 'falsified' || kind === 'triggered' || kind === 'missed';
  const cls = good ? 'up' : bad ? 'down' : kind === 'partial' ? 'ink2' : 'muted';
  return (
    <svg className={cls} width="15" height="15" viewBox="0 0 16 16" role="img" aria-label={label} style={{ display: 'block', marginTop: 3 }}>
      <title>{label}</title>
      {good || bad ? <circle cx="8" cy="8" r="7" fill="currentColor" /> : <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {kind === 'partial' ? <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5Z" fill="currentColor" /> : null}
      {good ? <path d="m4.6 8.2 2.2 2.2 4.6-4.7" fill="none" stroke="var(--sheet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {kind === 'triggered' ? <path d="M8 4.3v4.6M8 11.2v.4" stroke="var(--sheet)" strokeWidth="1.8" strokeLinecap="round" /> : null}
      {kind === 'falsified' || kind === 'missed' ? <path d="m5.4 5.4 5.2 5.2m0-5.2-5.2 5.2" stroke="var(--sheet)" strokeWidth="1.8" strokeLinecap="round" /> : null}
    </svg>
  );
}

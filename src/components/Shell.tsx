import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { LogoMark } from './Logo.tsx';
import { useStore } from '../lib/store.tsx';
import { fmtDateTime } from '../lib/format.ts';

export function PreviewRibbon() {
  const { site } = useStore();
  if (!site.config.site.experimental) return null;
  return (
    <div className="preview-ribbon">
      <b>Preview build.</b> Views marked Example are placeholders, not the author's positions.
    </div>
  );
}

export function Header({ onSearch, onWrite }: { onSearch: () => void; onWrite: () => void }) {
  const { site, mode, owner, canEdit } = useStore();
  const [layersOpen, setLayersOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLayersOpen(false);
    setMobileOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!layersOpen) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setLayersOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [layersOpen]);

  const layersActive = loc.pathname.startsWith('/layer') || loc.pathname.startsWith('/industry') || loc.pathname.startsWith('/theme');
  const links = [
    { to: '/views', label: 'Views' },
    { to: '/research', label: 'Research' },
    { to: '/news', label: 'News' },
    { to: '/calendar', label: 'Calendar' },
    { to: '/journal', label: 'Journal' },
  ];

  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" className="brand" aria-label={`${site.config.site.name}, home`}>
          <LogoMark />
          <span className="brand-name">{site.config.site.name}</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            Map
          </NavLink>
          <div style={{ position: 'relative' }} ref={popRef}>
            <button
              type="button"
              className={`navlink${layersActive ? ' active' : ''}`}
              aria-expanded={layersOpen}
              onClick={() => setLayersOpen((v) => !v)}
              style={layersActive ? { background: 'var(--sheet)', boxShadow: 'inset 0 0 0 1px var(--rule)', color: 'var(--ink)' } : undefined}
            >
              Layers ▾
            </button>
            {layersOpen ? <LayersMenu /> : null}
          </div>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-tools">
          <button type="button" className="searchbtn" onClick={onSearch} aria-label="Search">
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M7 1.5a5.5 5.5 0 0 1 4.38 8.83l3.15 3.14-1.06 1.06-3.14-3.15A5.5 5.5 0 1 1 7 1.5Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
            </svg>
            <span className="label">Search companies, views…</span>
            <kbd>⌘K</kbd>
          </button>
          {canEdit ? (
            <button type="button" className="btn primary" onClick={onWrite}>
              New view
            </button>
          ) : null}
          {mode !== 'visitor' ? (
            <Link to="/settings" className="badge" title={mode === 'owner' ? `Signed in as ${owner?.login}` : 'Demo mode: edits stay in this browser'}>
              {mode === 'owner' ? `Owner · ${owner?.login ?? ''}` : 'Demo'}
            </Link>
          ) : null}
          <button type="button" className="btn icon menubtn" aria-label="Menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path fill="currentColor" d="M2 3.5h12V5H2zm0 3.75h12v1.5H2zM2 11h12v1.5H2z" />
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen ? (
        <div className="mobile-nav">
          <div className="wrap">
            <Link to="/">Map</Link>
            {site.layers
              .slice()
              .reverse()
              .map((l) => (
                <Link key={l.id} to={`/layer/${l.id}`}>
                  L{l.order} · {l.name}
                </Link>
              ))}
            {links.map((l) => (
              <Link key={l.to} to={l.to}>
                {l.label}
              </Link>
            ))}
            <Link to="/themes">Themes</Link>
            <Link to="/settings">Settings</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LayersMenu() {
  const { site } = useStore();
  return (
    <div
      className="card"
      style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, width: 360, padding: 8, boxShadow: 'var(--shadow)', zIndex: 50 }}
    >
      {site.layers
        .slice()
        .reverse()
        .map((l) => (
          <Link key={l.id} to={`/layer/${l.id}`} className="menu-layer" data-layer={l.id}>
            <span className="menu-code">L{l.order}</span>
            <span className="grow">
              <b>{l.name}</b>
              <span className="muted"> · {l.industries.length} industries</span>
              <span className="menu-tag">{l.tagline}</span>
            </span>
          </Link>
        ))}
      <hr style={{ margin: '6px 4px' }} />
      <Link to="/themes" className="menu-layer">
        <span className="menu-code">✳</span>
        <span className="grow">
          <b>Themes</b>
          <span className="menu-tag">Cross-layer ideas: HBM, power, optics, agents…</span>
        </span>
      </Link>
    </div>
  );
}

export function Footer() {
  const { site, meta } = useStore();
  const s = site.config.site;
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div>
          <p>
            <b style={{ color: 'var(--ink)' }}>{s.name}</b> organizes the AI economy into five layers — energy, chips, infrastructure, models
            and applications — following the framework Jensen Huang set out in 2026.
          </p>
          <p>{s.disclaimer}</p>
          <p className="faint">
            Prices: daily closes via Yahoo Finance, updated after the Asian and US closes{meta.dataUpdatedAt ? ` · last update ${fmtDateTime(meta.dataUpdatedAt, s.timezone)}` : ''}.
          </p>
        </div>
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <span>
            Research and views by{' '}
            <a href={s.ownerUrl} target="_blank" rel="noreferrer">
              {s.owner}
            </a>
          </span>
          <Link to="/about">About & method</Link>
          <Link to="/settings">Settings & owner sign-in</Link>
          <a href={`https://github.com/${site.config.repos.public.owner}/${site.config.repos.public.repo}`} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { LogoMark } from './Logo.tsx';
import { useStore } from '../lib/store.tsx';
import { fmtDate, fmtDateTime } from '../lib/format.ts';
import { daysToExpiry, knownExpiry, WARN_DAYS } from '../lib/tokenExpiry.ts';

/** Owner only: the sign-in token is about to expire (or has). */
export function TokenRibbon() {
  const { mode } = useStore();
  const days = mode === 'owner' ? daysToExpiry() : undefined;
  if (days === undefined || days > WARN_DAYS) return null;
  return (
    <div className="preview-ribbon warn" role="status">
      <b>{days < 0 ? 'Your sign-in token has expired.' : `Your sign-in token expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} (${fmtDate(knownExpiry())}).`}</b>{' '}
      Create a new one and sign in again with it: <Link to="/settings#owner">Settings</Link>.
    </div>
  );
}

export function PreviewRibbon() {
  const { site, mode, startDemo, toast } = useStore();
  if (!site.config.site.experimental) return null;
  return (
    <div className="preview-ribbon">
      <b>Preview build.</b>{' '}
      {site.config.site.showExamples
        ? "Views marked Example are placeholders, not the author's positions."
        : 'Prices update every trading day; views and notes appear as they are written.'}
      {mode === 'visitor' ? (
        <button
          type="button"
          className="ribbon-btn"
          onClick={() => {
            startDemo();
            toast('Editors are on. Write with “New view” (top right) or “Quick note” (bottom right). Drafts stay in this browser.');
          }}
        >
          Try the editors
        </button>
      ) : null}
    </div>
  );
}

type NavItem = { to: string; label: string };
const NAV_GAP = 2; // px; matches the .nav gap

export function Header({ onSearch, onWrite }: { onSearch: () => void; onWrite: () => void }) {
  const { site, mode, owner, canEdit } = useStore();
  const [open, setOpen] = useState<'layers' | 'more' | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  // In display order; when the header is narrow, links leave from the end into "More".
  const links: NavItem[] = [
    { to: '/views', label: 'Views' },
    { to: '/research', label: 'Research' },
    { to: '/news', label: 'News' },
    { to: '/indicators', label: 'Indicators' },
    { to: '/journal', label: 'Journal' },
    { to: '/notes', label: 'Notes' },
    ...(canEdit ? [{ to: '/inbox', label: 'Inbox' }] : []),
    { to: '/calendar', label: 'Calendar' },
  ];
  const [visible, setVisible] = useState(links.length);

  useEffect(() => {
    setOpen(null);
    setMobileOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!open) return;
    const ref = open === 'layers' ? layersRef : moreRef;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Show as many links as fit between the brand and the tools, measured from a hidden copy of the row.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const fit = () => {
      const widths = Array.from(measure.children, (c) => c.getBoundingClientRect().width);
      let room = nav.clientWidth;
      for (const el of nav.querySelectorAll<HTMLElement>(':scope > [data-fixed]')) room -= el.getBoundingClientRect().width + NAV_GAP;
      let n = 0;
      for (const w of widths) {
        if (w + NAV_GAP > room) break;
        room -= w + NAV_GAP;
        n += 1;
      }
      setVisible(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [links.length]);

  const toggle = (which: 'layers' | 'more') => setOpen((v) => (v === which ? null : which));
  const layersActive = loc.pathname.startsWith('/layer') || loc.pathname.startsWith('/industry') || loc.pathname.startsWith('/theme');
  const overflow = links.slice(visible);
  const moreActive = [...overflow.map((l) => l.to), '/settings', '/about'].some((p) => loc.pathname.startsWith(p));

  return (
    <header className={`site-header${canEdit ? ' editing' : ''}`}>
      <div className="wrap">
        <Link to="/" className="brand" aria-label={`${site.config.site.name}, home`}>
          <LogoMark />
          <span className="brand-name">{site.config.site.name}</span>
        </Link>
        <nav className="nav" aria-label="Main" ref={navRef}>
          <NavLink to="/" end data-fixed="true">
            Map
          </NavLink>
          <div className="navpop" ref={layersRef} data-fixed="true">
            <button type="button" className={`navlink${layersActive ? ' active' : ''}`} aria-expanded={open === 'layers'} onClick={() => toggle('layers')}>
              Layers ▾
            </button>
            {open === 'layers' ? <LayersMenu /> : null}
          </div>
          {links.slice(0, visible).map((l) => (
            <NavLink key={l.to} to={l.to}>
              {l.label}
            </NavLink>
          ))}
          <div className="navpop" ref={moreRef} data-fixed="true">
            <button type="button" className={`navlink${moreActive ? ' active' : ''}`} aria-expanded={open === 'more'} onClick={() => toggle('more')}>
              More ▾
            </button>
            {open === 'more' ? <MoreMenu items={overflow} signedIn={mode === 'owner'} /> : null}
          </div>
          <div className="nav-measure" ref={measureRef} aria-hidden="true">
            {links.map((l) => (
              <span key={l.to}>{l.label}</span>
            ))}
          </div>
        </nav>
        <div className="header-tools">
          <button type="button" className="searchbtn" onClick={onSearch} aria-label="Search" title="Search (⌘K)">
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
          {mode === 'owner' ? (
            <Link to="/settings" className="badge" title={`Signed in as ${owner?.login ?? 'the owner'}`}>
              Owner
            </Link>
          ) : (
            <>
              {mode === 'demo' ? (
                <Link to="/settings" className="badge" title="Demo mode: edits stay in this browser">
                  Demo
                </Link>
              ) : null}
              {/* Shown in demo mode too, so the owner can always find the way to sign in. */}
              <Link to="/settings" className="btn sm ghost signin" title="Owner sign-in and display settings">
                Sign in
              </Link>
            </>
          )}
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
            <Link to="/settings">{mode === 'owner' ? 'Settings' : 'Sign in & settings'}</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function MoreMenu({ items, signedIn }: { items: NavItem[]; signedIn: boolean }) {
  const { canEdit } = useStore();
  return (
    <div className="card nav-menu">
      {items.map((l) => (
        <Link key={l.to} to={l.to} className="menu-item">
          {l.label}
        </Link>
      ))}
      {items.length ? <hr /> : null}
      {canEdit ? (
        <Link to="/calls" className="menu-item">
          Sell-side calls
        </Link>
      ) : null}
      <Link to="/themes" className="menu-item">
        Themes
      </Link>
      <Link to="/about" className="menu-item">
        About & method
      </Link>
      <Link to="/settings" className="menu-item">
        {signedIn ? 'Settings' : 'Sign in & settings'}
      </Link>
    </div>
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
      <Link to="/indicators" className="menu-layer">
        <span className="menu-code">▮</span>
        <span className="grow">
          <b>Indicators</b>
          <span className="menu-tag">Capex, chip sales, memory prices, Taiwan monthly sales</span>
        </span>
      </Link>
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

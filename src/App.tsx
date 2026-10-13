import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Footer, Header, PreviewRibbon, Toasts, TokenRibbon } from './components/Shell.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { useStore } from './lib/store.tsx';
import Home from './pages/Home.tsx';

const LayerPage = lazy(() => import('./pages/LayerPage.tsx'));
const IndustryPage = lazy(() => import('./pages/IndustryPage.tsx'));
const CompanyPage = lazy(() => import('./pages/CompanyPage.tsx'));
const ViewsPage = lazy(() => import('./pages/ViewsPage.tsx'));
const ThesisPage = lazy(() => import('./pages/ThesisPage.tsx'));
const ResearchPage = lazy(() => import('./pages/ResearchPage.tsx'));
const ReportPage = lazy(() => import('./pages/ReportPage.tsx'));
const NewsPage = lazy(() => import('./pages/NewsPage.tsx'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.tsx'));
const JournalPage = lazy(() => import('./pages/JournalPage.tsx'));
const NotesPage = lazy(() => import('./pages/NotesPage.tsx'));
const ThemesPage = lazy(() => import('./pages/ThemesPage.tsx'));
const ThemePage = lazy(() => import('./pages/ThemePage.tsx'));
const IndicatorsPage = lazy(() => import('./pages/IndicatorsPage.tsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.tsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx'));
const InboxPage = lazy(() => import('./pages/InboxPage.tsx'));
const CallsPage = lazy(() => import('./pages/CallsPage.tsx'));
const Editors = lazy(() => import('./editor/EditorHost.tsx'));

export type EditorRequest =
  | { kind: 'thesis'; id?: string; preset?: Record<string, unknown> }
  | { kind: 'note'; id?: string; preset?: Record<string, unknown> }
  | { kind: 'journal'; id?: string }
  | { kind: 'outlook'; id?: string }
  | { kind: 'upload' };

// A tiny global channel so any page can open an editor without prop drilling.
type Listener = (r: EditorRequest) => void;
const listeners = new Set<Listener>();
export function openEditor(r: EditorRequest) {
  for (const l of listeners) l(r);
}

export default function App() {
  const { canEdit, site } = useStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const loc = useLocation();

  useEffect(() => {
    const l: Listener = (r) => setEditor(r);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!loc.hash) window.scrollTo(0, 0);
    else {
      const id = decodeURIComponent(loc.hash.slice(1));
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }, [loc.pathname, loc.hash]);

  useEffect(() => {
    document.title = site.config.site.name;
  }, [site]);

  return (
    <>
      <TokenRibbon />
      <PreviewRibbon />
      <Header onSearch={() => setSearchOpen(true)} onWrite={() => setEditor({ kind: 'thesis' })} />
      <main id="main" style={{ flex: 1 }}>
        <Suspense fallback={<div className="page"><div className="wrap"><span className="spinner" /></div></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/layer/:layerId" element={<LayerPage />} />
            <Route path="/industry/:layerId/:industryId" element={<IndustryPage />} />
            <Route path="/company/:companyId" element={<CompanyPage />} />
            <Route path="/views" element={<ViewsPage />} />
            <Route path="/thesis/:id" element={<ThesisPage />} />
            <Route path="/research" element={<ResearchPage />} />
            <Route path="/report/:id" element={<ReportPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/themes" element={<ThemesPage />} />
            <Route path="/theme/:id" element={<ThemePage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/calls" element={<CallsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      {canEdit && !editor ? (
        <button type="button" className="fab" onClick={() => setEditor({ kind: 'note' })}>
          <span aria-hidden="true">＋</span> Quick note
        </button>
      ) : null}
      {searchOpen ? <CommandPalette onClose={() => setSearchOpen(false)} /> : null}
      {editor ? (
        <Suspense fallback={null}>
          <Editors request={editor} onClose={() => setEditor(null)} />
        </Suspense>
      ) : null}
      <Toasts />
    </>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="wrap">
        <h1>Page not found</h1>
        <p className="lede" style={{ marginTop: 10 }}>
          That link does not point to anything on the map. Use search (⌘K) to find a company, industry or view.
        </p>
      </div>
    </div>
  );
}

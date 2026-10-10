import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import { StoreProvider } from './lib/store.tsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

function Boot({ error }: { error?: string }) {
  return (
    <div className="wrap" style={{ paddingBlock: '20vh' }}>
      {error ? (
        <div className="empty">
          <b>The map could not load.</b>
          <br />
          {error}
        </div>
      ) : (
        <div className="row muted">
          <span className="spinner" /> Loading the map…
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <StoreProvider fallback={(e) => <Boot error={e} />}>
        <App />
      </StoreProvider>
    </HashRouter>
  </StrictMode>,
);

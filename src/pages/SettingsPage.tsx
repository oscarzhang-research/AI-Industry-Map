import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Section, Segmented } from '../components/ui.tsx';
import { commitFiles, dispatchWorkflow, getRawFile } from '../lib/github.ts';
import { setSiteFlag } from '../lib/configEdit.ts';
import { clearDemo, loadDemoRecords } from '../lib/demo.ts';
import { fmtDate, fmtDateTime, plural } from '../lib/format.ts';
import { rememberExpiry, savedExpiry, SETTINGS_PATH, withTokenExpiry } from '../lib/tokenExpiry.ts';
import { tokenExpiryHeader } from '../lib/github.ts';

export default function SettingsPage() {
  const store = useStore();
  const { site, prefs, setPrefs, mode, owner, vault, meta, signIn, signOut, reloadVault, startDemo, stopDemo, toast, token, canEdit } = store;
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [exported, setExported] = useState<string>();
  const repos = site.config.repos;
  const guide = `https://github.com/${repos.public.owner}/${repos.public.repo}/blob/main/docs/OWNER-GUIDE.zh-CN.md`;

  const doSignIn = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await signIn(tok);
      setTok('');
      toast('Signed in. Your private vault is loading.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The example records are switched for the whole site by editing site.config.yaml; the push rebuilds it.
  const [examplesOn, setExamplesOn] = useState(site.config.site.showExamples !== false);
  const [examplesSave, setExamplesSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const setShowExamples = async (on: boolean) => {
    const t = token();
    if (!t || examplesSave === 'saving' || on === examplesOn) return;
    setExamplesSave('saving');
    try {
      const path = 'site.config.yaml';
      const current = new TextDecoder().decode(await getRawFile(t, repos.public, path));
      await commitFiles(t, repos.public, [{ path, text: setSiteFlag(current, 'showExamples', on) }], on ? 'Show example content (site settings)' : 'Hide example content (site settings)');
      setExamplesOn(on);
      setExamplesSave('saved');
    } catch (e) {
      setExamplesSave('idle');
      toast(`Could not save the change: ${(e as Error).message}`, 'error');
    }
  };

  // One refresh per visit to this page: each click starts a full download on GitHub Actions.
  const [refresh, setRefresh] = useState<'idle' | 'starting' | 'started'>('idle');
  const refreshData = async () => {
    const t = token();
    if (!t || refresh !== 'idle') return;
    setRefresh('starting');
    try {
      await dispatchWorkflow(t, repos.public, 'market-data.yml', { markets: 'all' });
      setRefresh('started');
      toast('Market data refresh started. Prices update in about five minutes.');
    } catch (e) {
      setRefresh('idle');
      toast(`Could not start the refresh: ${(e as Error).message}. The token needs “Actions: Read and write” on the public repository.`, 'error');
    }
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 920 }}>
        <div className="eyebrow">Settings</div>
        <h1 style={{ marginTop: 4 }}>Settings</h1>
        <p className="lede" style={{ marginTop: 8 }}>
          Sign in as the owner, try the editors in demo mode, or change how the site looks. Display preferences are saved in this browser only.
        </p>
        {canEdit ? (
          <div className="note-callout" style={{ marginTop: 16 }}>
            <b>{mode === 'demo' ? 'Demo mode is on.' : 'You are signed in.'} Where to write:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: '1.2em' }}>
              <li>
                <b>New view</b>, top right: a call on a company, an industry or a layer.
              </li>
              <li>
                <b>Quick note</b>, bottom right, or <b>Save as note</b> under any item on the <Link to="/news">News</Link> page.
              </li>
              <li>
                <Link to="/journal">Journal</Link>: <b>New entry</b> for a weekly or monthly review, <b>Update outlook</b> for the bottleneck call.
              </li>
              <li>Any company or industry page: <b>New view</b> and <b>Add note</b> in its sections.</li>
            </ul>
          </div>
        ) : null}

        <Section title="Display">
          <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            <Pref label="Theme">
              <Segmented
                label="Theme"
                value={prefs.theme}
                onChange={(v) => setPrefs({ theme: v })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Pref>
            <Pref label="Price colors" hint="US convention is green for up; much of Asia uses red for up.">
              <Segmented
                label="Price colors"
                value={prefs.updown}
                onChange={(v) => setPrefs({ updown: v })}
                options={[
                  { value: 'green', label: 'Green up · red down' },
                  { value: 'red', label: 'Red up · green down' },
                ]}
              />
            </Pref>
            <Pref label="Research language" hint="Bilingual reports open in this language.">
              <Segmented
                label="Research language"
                value={prefs.reportLang}
                onChange={(v) => setPrefs({ reportLang: v })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
              />
            </Pref>
          </div>
        </Section>

        <Section id="owner" title="Owner sign-in" sub="Only the site owner needs this. Visitors can read everything public without signing in.">
          {mode === 'owner' ? (
            <div className="card stack" style={{ '--gap': '12px' } as React.CSSProperties}>
              <div>
                Signed in as <b>{owner?.login}</b>.{' '}
                {vault.status === 'loading'
                  ? `Loading the private vault${vault.progress?.[1] ? ` (${vault.progress[0]} of ${vault.progress[1]} files)` : ''}…`
                  : vault.status === 'ready'
                    ? `Vault loaded: ${plural(vault.data?.records.length ?? 0, 'record')} and ${plural(vault.data?.reports.length ?? 0, 'private report')} (${fmtDateTime(vault.data?.loadedAt, site.config.site.timezone)}).`
                    : vault.status === 'error'
                      ? `The vault did not load: ${vault.error}`
                      : ''}
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => reloadVault()}>
                  Reload vault
                </button>
                <button type="button" className="btn" onClick={refreshData} disabled={refresh !== 'idle'}>
                  {refresh === 'started' ? 'Refresh started' : refresh === 'starting' ? 'Starting…' : 'Refresh market data now'}
                </button>
                <Link className="btn" to="/inbox">
                  Open inbox
                </Link>
                <button type="button" className="btn ghost" onClick={signOut}>
                  Sign out
                </button>
              </div>
              <TokenExpiry />
              <p className="faint" style={{ fontSize: 'var(--step--2)' }}>
                The token is stored in this browser only and is sent only to api.github.com. Sign out on shared computers.
              </p>
            </div>
          ) : (
            <div className="card stack" style={{ '--gap': '12px' } as React.CSSProperties}>
              <p style={{ fontSize: 'var(--step--1)', color: 'var(--ink-2)' }}>
                Paste a fine-grained GitHub token with <b>Contents: Read and write</b> on <code>{repos.public.repo}</code> and the private <code>{repos.vault.repo}</code>{' '}
                repository (add <b>Actions: Read and write</b> to refresh prices from here). Step-by-step instructions, in Chinese:{' '}
                <a href={guide} target="_blank" rel="noopener noreferrer">
                  owner guide
                </a>
                .
              </p>
              <div className="row">
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="github_pat_…"
                  value={tok}
                  onChange={(e) => setTok(e.target.value)}
                  style={{ maxWidth: 420 }}
                  aria-label="GitHub token"
                  id="owner-token"
                />
                <button type="button" className="btn primary" disabled={busy || tok.trim().length < 20} onClick={doSignIn}>
                  {busy ? 'Checking…' : 'Sign in'}
                </button>
              </div>
              {err ? (
                <p className="down" style={{ fontSize: 'var(--step--1)' }}>
                  {err}
                </p>
              ) : null}
            </div>
          )}
        </Section>

        {mode === 'owner' ? (
          <Section
            id="examples"
            title="Example content"
            sub="Placeholder views, notes and a journal entry that show how the site works before you write your own. The switch applies to everyone, you included."
          >
            <div className="card stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <Pref label="Examples on the site">
                <Segmented
                  label="Example content"
                  value={examplesOn ? 'shown' : 'hidden'}
                  onChange={(v) => void setShowExamples(v === 'shown')}
                  options={[
                    { value: 'shown', label: 'Shown' },
                    { value: 'hidden', label: 'Hidden' },
                  ]}
                />
              </Pref>
              <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
                {examplesSave === 'saving'
                  ? 'Saving…'
                  : examplesSave === 'saved'
                    ? `Saved. The site is rebuilding; reload in about two minutes and the examples will be ${examplesOn ? 'back' : 'gone'}.`
                    : 'Changing this edits site.config.yaml in the public repository, and the site rebuilds in about two minutes.'}
              </div>
            </div>
          </Section>
        ) : null}

        <Section id="demo" title="Demo mode" sub="Try the editors without signing in. Everything you write stays in this browser and is never uploaded.">
          <div className="card stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <div className="row">
              {mode === 'demo' ? (
                <>
                  <span className="badge">Demo mode is on</span>
                  <button type="button" className="btn" onClick={stopDemo}>
                    Leave demo mode
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setExported(JSON.stringify(loadDemoRecords(), null, 2));
                    }}
                  >
                    Show my demo records
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      clearDemo();
                      stopDemo();
                      startDemo();
                      setExported(undefined);
                      toast('Demo records cleared.');
                    }}
                  >
                    Clear demo records
                  </button>
                </>
              ) : (
                <button type="button" className="btn" disabled={mode === 'owner'} onClick={startDemo}>
                  Start demo mode
                </button>
              )}
            </div>
            {exported ? (
              <textarea className="textarea" readOnly rows={8} value={exported} aria-label="Demo records as JSON" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }} />
            ) : null}
          </div>
        </Section>

        <Section title="Data">
          <dl className="kv">
            <dt>Prices as of</dt>
            <dd>{meta.pricesAsOf ?? '—'}</dd>
            <dt>Market data updated</dt>
            <dd>{fmtDateTime(meta.dataUpdatedAt, site.config.site.timezone)}</dd>
            <dt>Site built</dt>
            <dd>{fmtDateTime(meta.generatedAt, site.config.site.timezone)}</dd>
            <dt>Price series</dt>
            <dd>{meta.counts.series ?? '—'}</dd>
            <dt>Schedule</dt>
            <dd>Weekdays at 10:30 UTC (after the Asian close) and 21:35 UTC (after the US close)</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Pref({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="min0">
        <b style={{ fontSize: 'var(--step--1)' }}>{label}</b>
        {hint ? (
          <div className="muted" style={{ fontSize: 'var(--step--2)' }}>
            {hint}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** The token's expiry: read from GitHub when possible, else entered here; saved to the vault for email reminders. */
function TokenExpiry() {
  const { site, token, toast } = useStore();
  const header = tokenExpiryHeader();
  const [vaultValue, setVaultValue] = useState<string | null | undefined>(undefined); // undefined: loading, null: none saved
  const [draft, setDraft] = useState(savedExpiry() ?? header ?? '');
  const [busy, setBusy] = useState(false);
  const repo = site.config.repos.vault;

  useEffect(() => {
    const t = token();
    if (!t) return;
    let alive = true;
    getRawFile(t, repo, SETTINGS_PATH)
      .then((buf) => {
        const day = /^tokenExpires:\s*(\d{4}-\d{2}-\d{2})/m.exec(new TextDecoder().decode(buf))?.[1] ?? null;
        if (!alive) return;
        setVaultValue(day);
        if (day) {
          rememberExpiry(day);
          setDraft((d) => d || day);
        }
      })
      .catch(() => alive && setVaultValue(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.owner, repo.repo, repo.branch]);

  const save = async (day: string) => {
    const t = token();
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    setBusy(true);
    try {
      let prev: string | undefined;
      try {
        prev = new TextDecoder().decode(await getRawFile(t, repo, SETTINGS_PATH));
      } catch {
        prev = undefined;
      }
      await commitFiles(t, repo, [{ path: SETTINGS_PATH, text: withTokenExpiry(prev, day) }], `Token expires ${day} (site settings)`);
      rememberExpiry(day);
      setVaultValue(day);
      toast('Saved. You will get a reminder two weeks before.');
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const known = header ?? vaultValue ?? undefined;
  return (
    <div className="stack" style={{ '--gap': '6px', fontSize: 'var(--step--1)' } as React.CSSProperties}>
      <div className="row" style={{ gap: 8 }}>
        <span className="muted">Token expires</span>
        {known ? <b>{fmtDate(known)}</b> : <span className="muted">not recorded</span>}
        {header && header !== vaultValue ? (
          <button type="button" className="btn sm" disabled={busy} onClick={() => void save(header)}>
            Remind me before then
          </button>
        ) : null}
      </div>
      {!header ? (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="date" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ maxWidth: 180 }} aria-label="Token expiry date" />
          <button type="button" className="btn sm" disabled={busy || !draft || draft === vaultValue} onClick={() => void save(draft)}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
            The date GitHub showed when you created the token (Settings → Developer settings → Fine-grained tokens).
          </span>
        </div>
      ) : null}
      <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
        Two weeks before, a banner appears here and the private repository's alerts email you a reminder.
      </span>
    </div>
  );
}

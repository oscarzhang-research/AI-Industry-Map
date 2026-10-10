import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadCore, type CoreData } from './data.ts';
import { buildIndex, type TaxonomyIndex } from './nodes.ts';
import { applyPrefs, loadPrefs, savePrefs, storageGet, storageSet, type Prefs } from './settings.ts';
import { deleteDemoRecord, loadDemoRecords, saveDemoRecord } from './demo.ts';
import { repoAccess, whoami } from './github.ts';
import { clearVaultCache, deleteRecordFromGitHub, loadVault, saveRecordToGitHub, uploadReport, type UploadInput, type VaultData } from './vault.ts';
import type { AnyRecord, Company, Quote, ReportMeta } from './types.ts';

export type Mode = 'visitor' | 'owner' | 'demo';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface VaultState {
  status: 'off' | 'loading' | 'ready' | 'error';
  error?: string;
  progress?: [number, number];
  data?: VaultData;
}

export interface Store extends CoreData {
  index: TaxonomyIndex;
  mode: Mode;
  canEdit: boolean;
  owner?: { login: string };
  vault: VaultState;
  allRecords: AnyRecord[];
  allReports: ReportMeta[];
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  reloadVault: () => Promise<void>;
  startDemo: () => void;
  stopDemo: () => void;
  saveRecord: (rec: AnyRecord, previous?: AnyRecord) => Promise<void>;
  deleteRecord: (rec: AnyRecord) => Promise<void>;
  upload: (input: UploadInput) => Promise<ReportMeta>;
  toast: (text: string, kind?: 'info' | 'error') => void;
  toasts: Toast[];
  quote: (symbol?: string) => Quote | undefined;
  company: (id?: string) => Company | undefined;
  token: () => string | null;
}

const Ctx = createContext<Store | null>(null);
const TOKEN_KEY = 'aim.gh.token';
const MODE_KEY = 'aim.mode';

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (error?: string) => ReactNode }) {
  const [core, setCore] = useState<CoreData | null>(null);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<Mode>('visitor');
  const [owner, setOwner] = useState<{ login: string }>();
  const [vault, setVault] = useState<VaultState>({ status: 'off' });
  const [demoRecords, setDemoRecords] = useState<AnyRecord[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs('green'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3200);
  }, []);

  useEffect(() => {
    loadCore()
      .then((d) => {
        setCore(d);
        const initial = loadPrefs(d.site.config.site.upColor);
        setPrefsState(initial);
        applyPrefs(initial);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      applyPrefs(next);
      return next;
    });
  }, []);

  const doLoadVault = useCallback(
    async (token: string) => {
      if (!core) return;
      setVault({ status: 'loading', progress: [0, 0] });
      try {
        const data = await loadVault(token, core.site.config, (done, total) => setVault((v) => ({ ...v, progress: [done, total] })));
        setVault({ status: 'ready', data });
      } catch (e) {
        setVault({ status: 'error', error: (e as Error).message });
      }
    },
    [core],
  );

  // Restore the previous session's mode once the site data is in.
  useEffect(() => {
    if (!core) return;
    const saved = storageGet(MODE_KEY) as Mode | null;
    const token = storageGet(TOKEN_KEY);
    if (saved === 'owner' && token) {
      whoami(token)
        .then((u) => {
          setOwner(u);
          setMode('owner');
          return doLoadVault(token);
        })
        .catch(() => {
          setMode('visitor');
          toast('Your saved GitHub token no longer works. Sign in again from Settings.', 'error');
        });
    } else if (saved === 'demo') {
      setDemoRecords(loadDemoRecords());
      setMode('demo');
    }
  }, [core, doLoadVault, toast]);

  const signIn = useCallback(
    async (token: string) => {
      if (!core) return;
      const t = token.trim();
      const user = await whoami(t);
      const [vaultAccess, pubAccess] = await Promise.all([
        repoAccess(t, core.site.config.repos.vault).catch(() => null),
        repoAccess(t, core.site.config.repos.public).catch(() => null),
      ]);
      if (!vaultAccess) throw new Error(`This token cannot see ${core.site.config.repos.vault.owner}/${core.site.config.repos.vault.repo}. Create that private repository and give the token access to it.`);
      if (!vaultAccess.push || !pubAccess?.push) throw new Error('The token needs "Contents: Read and write" on both repositories.');
      if (!vaultAccess.private) throw new Error('The vault repository is public. Make it private before storing anything there.');
      storageSet(TOKEN_KEY, t);
      storageSet(MODE_KEY, 'owner');
      setOwner(user);
      setMode('owner');
      await doLoadVault(t);
    },
    [core, doLoadVault],
  );

  const signOut = useCallback(() => {
    storageSet(TOKEN_KEY, null);
    storageSet(MODE_KEY, null);
    clearVaultCache();
    setOwner(undefined);
    setVault({ status: 'off' });
    setMode('visitor');
  }, []);

  const startDemo = useCallback(() => {
    storageSet(MODE_KEY, 'demo');
    setDemoRecords(loadDemoRecords());
    setMode('demo');
  }, []);

  const stopDemo = useCallback(() => {
    storageSet(MODE_KEY, null);
    setMode('visitor');
  }, []);

  const allRecords = useMemo(() => {
    if (!core) return [];
    const map = new Map<string, AnyRecord>();
    for (const r of core.records.records) map.set(r.id, r);
    if (mode === 'owner' && vault.data) for (const r of vault.data.records) map.set(r.id, r);
    if (mode === 'demo') for (const r of demoRecords) map.set(r.id, r);
    return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [core, mode, vault.data, demoRecords]);

  const allReports = useMemo(() => {
    if (!core) return [];
    const list: ReportMeta[] = [...core.reports];
    if (mode === 'owner' && vault.data) {
      const seen = new Set(list.map((r) => r.id));
      for (const r of vault.data.reports) if (!seen.has(r.id)) list.push(r);
    }
    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [core, mode, vault.data]);

  const saveRecord = useCallback(
    async (rec: AnyRecord, previous?: AnyRecord) => {
      if (!core) return;
      const stamped = { ...rec, updatedAt: new Date().toISOString() } as AnyRecord;
      if (mode === 'demo') {
        setDemoRecords(saveDemoRecord(stamped));
        toast('Saved in this browser (demo mode).');
        return;
      }
      if (mode !== 'owner' || !vault.data) throw new Error('Sign in as the owner to save.');
      const token = storageGet(TOKEN_KEY);
      if (!token) throw new Error('Missing GitHub token.');
      await saveRecordToGitHub(token, core.site.config, stamped, vault.data, previous);
      setVault((v) =>
        v.data
          ? { ...v, data: { ...v.data, records: [...v.data.records.filter((r) => r.id !== stamped.id), { ...stamped, origin: 'vault' }] } }
          : v,
      );
      toast(stamped.visibility === 'public' ? 'Saved. The public site updates in about two minutes.' : 'Saved to your private vault.');
    },
    [core, mode, vault.data, toast],
  );

  const deleteRecord = useCallback(
    async (rec: AnyRecord) => {
      if (!core) return;
      if (mode === 'demo') {
        setDemoRecords(deleteDemoRecord(rec.id));
        toast('Deleted (demo mode).');
        return;
      }
      if (mode !== 'owner' || !vault.data) throw new Error('Sign in as the owner to delete.');
      const token = storageGet(TOKEN_KEY);
      if (!token) throw new Error('Missing GitHub token.');
      await deleteRecordFromGitHub(token, core.site.config, rec, vault.data);
      setVault((v) => (v.data ? { ...v, data: { ...v.data, records: v.data.records.filter((r) => r.id !== rec.id) } } : v));
      toast('Deleted.');
    },
    [core, mode, vault.data, toast],
  );

  const upload = useCallback(
    async (input: UploadInput) => {
      if (!core) throw new Error('Not ready');
      if (mode !== 'owner') throw new Error('Uploading needs owner mode with the private vault connected.');
      const token = storageGet(TOKEN_KEY);
      if (!token) throw new Error('Missing GitHub token.');
      const meta = await uploadReport(token, core.site.config, input);
      if (meta.origin === 'vault') setVault((v) => (v.data ? { ...v, data: { ...v.data, reports: [...v.data.reports, meta] } } : v));
      toast(meta.origin === 'vault' ? 'Uploaded to your private vault.' : 'Uploaded. It appears in the public library after the next build.');
      return meta;
    },
    [core, mode, toast],
  );

  const value = useMemo<Store | null>(() => {
    if (!core) return null;
    const index = buildIndex(core.site);
    return {
      ...core,
      index,
      mode,
      canEdit: mode === 'owner' || mode === 'demo',
      owner,
      vault,
      allRecords,
      allReports,
      prefs,
      setPrefs,
      signIn,
      signOut,
      reloadVault: async () => {
        const t = storageGet(TOKEN_KEY);
        if (t) await doLoadVault(t);
      },
      startDemo,
      stopDemo,
      saveRecord,
      deleteRecord,
      upload,
      toast,
      toasts,
      quote: (s?: string) => (s ? core.quotes.quotes[s] : undefined),
      company: (id?: string) => (id ? core.site.companies[id] : undefined),
      token: () => storageGet(TOKEN_KEY),
    };
  }, [core, mode, owner, vault, allRecords, allReports, prefs, setPrefs, signIn, signOut, doLoadVault, startDemo, stopDemo, saveRecord, deleteRecord, upload, toast, toasts]);

  if (!value) return <>{fallback(error)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

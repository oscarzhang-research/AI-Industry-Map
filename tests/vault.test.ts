// Owner-mode storage against a small in-memory imitation of the GitHub Git Data API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitFiles } from '../src/lib/github.ts';
import { loadVault, saveRecordToGitHub, deleteRecordFromGitHub, uploadReport } from '../src/lib/vault.ts';
import type { RepoRef, SiteConfig, ThesisRecord } from '../src/lib/types.ts';

type Files = Map<string, Uint8Array>;
interface Repo {
  private: boolean;
  head: string | null;
  commits: Map<string, { tree: string; parents: string[] }>;
  trees: Map<string, Files>;
  blobs: Map<string, Uint8Array>;
}

let repos: Record<string, Repo>;
let seq = 0;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha = (p: string) => `${p}${++seq}`;
const blobSha = (bytes: Uint8Array) => `b${dec.decode(bytes).length}-${[...bytes].reduce((a, x) => (a * 31 + x) >>> 0, 7)}`;

function newRepo(priv: boolean): Repo {
  return { private: priv, head: null, commits: new Map(), trees: new Map(), blobs: new Map() };
}

function filesAt(r: Repo): Files {
  if (!r.head) return new Map();
  return r.trees.get(r.commits.get(r.head)!.tree)!;
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const p = url.pathname;
  if (p === '/user') return json(200, { login: 'oscar' });
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return json(404, { message: 'Not Found' });
  const repo = repos[`${m[1]}/${m[2]}`];
  if (!repo) return json(404, { message: 'Not Found' });
  const rest = m[3] ?? '';
  if (!rest) return json(200, { private: repo.private, permissions: { push: true } });
  if (rest === '/git/ref/heads/main') return repo.head ? json(200, { object: { sha: repo.head } }) : json(409, { message: 'Git Repository is empty.' });
  let k = /^\/git\/commits\/(.+)$/.exec(rest);
  if (k && method === 'GET') return json(200, { tree: { sha: repo.commits.get(k[1])!.tree } });
  k = /^\/git\/trees\/(.+)$/.exec(rest);
  if (k && method === 'GET') {
    const c = repo.commits.get(k[1]);
    const files = c ? repo.trees.get(c.tree)! : repo.trees.get(k[1])!;
    return json(200, { truncated: false, tree: [...files.entries()].map(([path, bytes]) => ({ path, type: 'blob', sha: blobSha(bytes), size: bytes.length })) });
  }
  k = /^\/git\/blobs\/(.+)$/.exec(rest);
  if (k && method === 'GET') {
    for (const files of repo.trees.values()) for (const bytes of files.values()) if (blobSha(bytes) === k[1]) return json(200, { content: b64(bytes), encoding: 'base64' });
    return json(404, { message: 'blob not found' });
  }
  if (rest === '/git/blobs' && method === 'POST') {
    const bytes = unb64(body.content);
    const s = blobSha(bytes);
    repo.blobs.set(s, bytes);
    return json(201, { sha: s });
  }
  if (rest === '/git/trees' && method === 'POST') {
    const files: Files = new Map(body.base_tree ? repo.trees.get(body.base_tree)! : []);
    for (const e of body.tree as { path: string; sha?: string | null; content?: string }[]) {
      if (e.sha === null) {
        if (!files.has(e.path)) return json(422, { message: 'path not found' });
        files.delete(e.path);
      } else if (e.content !== undefined) files.set(e.path, enc.encode(e.content));
      else files.set(e.path, repo.blobs.get(e.sha!)!);
    }
    const t = sha('t');
    repo.trees.set(t, files);
    return json(201, { sha: t });
  }
  if (rest === '/git/commits' && method === 'POST') {
    const c = sha('c');
    repo.commits.set(c, { tree: body.tree, parents: body.parents });
    return json(201, { sha: c });
  }
  if (rest === '/git/refs/heads/main' && method === 'PATCH') {
    const c = repo.commits.get(body.sha)!;
    if ((c.parents[0] ?? null) !== repo.head) return json(422, { message: 'Update is not a fast forward' });
    repo.head = body.sha;
    return json(200, { object: { sha: body.sha } });
  }
  k = /^\/contents\/(.+)$/.exec(rest);
  if (k && method === 'PUT') {
    const path = k[1].split('/').map(decodeURIComponent).join('/');
    const files: Files = new Map(filesAt(repo));
    files.set(path, unb64(body.content));
    const t = sha('t');
    repo.trees.set(t, files);
    const c = sha('c');
    repo.commits.set(c, { tree: t, parents: repo.head ? [repo.head] : [] });
    repo.head = c;
    return json(201, { commit: { sha: c } });
  }
  if (k && method === 'GET') {
    const path = k[1].split('/').map(decodeURIComponent).join('/');
    const bytes = filesAt(repo).get(path);
    return bytes ? new Response(new Blob([bytes as BlobPart]), { status: 200 }) : json(404, { message: 'Not Found' });
  }
  return json(404, { message: `unhandled ${method} ${p}` });
}

const pub: RepoRef = { owner: 'o', repo: 'pub', branch: 'main' };
const vault: RepoRef = { owner: 'o', repo: 'vault', branch: 'main' };
const config = {
  site: {} as SiteConfig['site'],
  repos: { public: pub, vault },
  defaults: { publicHiddenFields: ['target', 'stop', 'scenarios', 'plan', 'position'] },
} as unknown as SiteConfig;
const read = (r: Repo, path: string) => {
  const b = filesAt(r).get(path);
  return b ? dec.decode(b) : undefined;
};

const thesis: ThesisRecord = {
  id: 'th-2026-10-10-nvda-long',
  type: 'thesis',
  visibility: 'private',
  createdAt: '2026-10-10T13:00:00.000Z',
  subject: { kind: 'company', company: 'nvidia' },
  direction: 'long',
  summary: 'Rubin keeps NVIDIA the default.',
  status: 'active',
  target: { price: 300 },
  plan: 'Add below 200.',
};

beforeEach(() => {
  repos = { 'o/pub': newRepo(false), 'o/vault': newRepo(true) };
  // The public repository already has a commit; the vault starts empty, as a new repository would.
  repos['o/pub'].trees.set('t0', new Map([['README.md', enc.encode('# site')]]));
  repos['o/pub'].commits.set('c0', { tree: 't0', parents: [] });
  repos['o/pub'].head = 'c0';
  vi.stubGlobal('fetch', fakeFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('commitFiles', () => {
  it('creates the first commit of an empty repository and then commits atomically', async () => {
    await commitFiles('t', vault, [
      { path: 'vault/notes/a.md', text: 'A' },
      { path: 'vault/notes/b.md', text: 'B' },
    ], 'first');
    const r = repos['o/vault'];
    expect(read(r, 'vault/notes/a.md')).toBe('A');
    expect(read(r, 'vault/notes/b.md')).toBe('B');
    await commitFiles('t', vault, [{ path: 'vault/notes/a.md', delete: true }, { path: 'vault/x.bin', bytes: new Uint8Array([1, 2, 3]) }], 'second');
    expect(read(r, 'vault/notes/a.md')).toBeUndefined();
    expect([...filesAt(r).get('vault/x.bin')!]).toEqual([1, 2, 3]);
  });

  it('rebuilds on the new head when someone pushed in between', async () => {
    const r = repos['o/pub'];
    let raced = false;
    const real = fakeFetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (!raced && String(input).endsWith('/git/refs/heads/main')) {
        raced = true; // the data job lands a commit just before our ref update
        const files: Files = new Map(filesAt(r));
        files.set('data/status.json', enc.encode('{}'));
        r.trees.set('tX', files);
        r.commits.set('cX', { tree: 'tX', parents: [r.head!] });
        r.head = 'cX';
      }
      return real(input, init);
    });
    await commitFiles('t', pub, [{ path: 'content/views/notes/n.md', text: 'N' }], 'note');
    expect(read(r, 'content/views/notes/n.md')).toBe('N');
    expect(read(r, 'data/status.json')).toBe('{}'); // the other commit survived
  });
});

describe('vault records', () => {
  it('keeps private records out of the public repository', async () => {
    await saveRecordToGitHub('t', config, thesis, { records: [], reports: [], vaultPaths: new Map(), publicPaths: new Map(), loadedAt: '' });
    expect(read(repos['o/vault'], 'vault/theses/th-2026-10-10-nvda-long.md')).toContain('plan: Add below 200.');
    expect([...filesAt(repos['o/pub']).keys()]).toEqual(['README.md']);
  });

  it('publishes a sanitized copy when public and removes it when made private again', async () => {
    const data = await loadVault('t', config);
    const open = { ...thesis, visibility: 'public' as const };
    await saveRecordToGitHub('t', config, open, data);
    const copy = read(repos['o/pub'], 'content/views/theses/th-2026-10-10-nvda-long.md')!;
    expect(copy).toContain('summary: Rubin keeps NVIDIA the default.');
    expect(copy).not.toContain('Add below 200');
    expect(copy).not.toContain('target');
    const full = read(repos['o/vault'], 'vault/theses/th-2026-10-10-nvda-long.md')!;
    expect(full).toContain('Add below 200');

    await saveRecordToGitHub('t', config, { ...open, visibility: 'private' }, data);
    expect(read(repos['o/pub'], 'content/views/theses/th-2026-10-10-nvda-long.md')).toBeUndefined();

    const again = await loadVault('t', config);
    expect(again.records.map((r) => r.id)).toEqual(['th-2026-10-10-nvda-long']);
    await deleteRecordFromGitHub('t', config, again.records[0], again);
    expect(read(repos['o/vault'], 'vault/theses/th-2026-10-10-nvda-long.md')).toBeUndefined();
  });
});

describe('uploads', () => {
  const file = (name: string, text: string) => ({ name, arrayBuffer: async () => enc.encode(text).buffer }) as unknown as File;

  it('sends PDFs and sell-side research to the vault only', async () => {
    const meta = await uploadReport('t', config, {
      file: file('x.pdf', '%PDF-1.7'),
      meta: { id: '2026-08-20-hsbc', kind: 'sell-side', visibility: 'public', format: 'pdf', file: '', title: 'HSBC', date: '2026-08-20', companies: [], nodes: [], tags: [] },
    });
    expect(meta.origin).toBe('vault');
    expect(read(repos['o/vault'], 'vault/reports/2026-08-20-hsbc/report.pdf')).toBe('%PDF-1.7');
    expect([...filesAt(repos['o/pub']).keys()].some((k) => k.includes('hsbc'))).toBe(false);
  });

  it('sends public Claude HTML research to the public repository', async () => {
    const meta = await uploadReport('t', config, {
      file: file('r.html', '<html></html>'),
      meta: { id: '2026-10-10-r', kind: 'claude', visibility: 'public', format: 'html', file: '', title: 'R', date: '2026-10-10', companies: [], nodes: [], tags: [] },
    });
    expect(meta.origin).toBe('public');
    expect(read(repos['o/pub'], 'content/reports/2026-10-10-r/report.html')).toBe('<html></html>');
    expect(read(repos['o/pub'], 'content/reports/2026-10-10-r/meta.yaml')).toContain('title: R');
  });
});

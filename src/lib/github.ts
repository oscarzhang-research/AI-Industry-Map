// Minimal GitHub REST client for owner mode. Runs in the owner's browser with a fine-grained
// personal access token limited to the two site repositories. Nothing here runs for visitors.
import type { RepoRef } from './types.ts';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let expiryHeader: string | undefined;
/** The token's expiry (YYYY-MM-DD) from GitHub's response header, if the browser was allowed to read it. */
export function tokenExpiryHeader(): string | undefined {
  return expiryHeader;
}

async function call<T>(token: string, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const exp = res.headers.get('github-authentication-token-expiration'); // e.g. "2027-10-10 12:00:00 UTC"
  if (exp && /^\d{4}-\d{2}-\d{2}/.test(exp)) expiryHeader = exp.slice(0, 10);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* not JSON */
    }
    throw new GitHubError(res.status, `${res.status} ${msg}`);
  }
  if (accept === 'application/vnd.github.raw') return (await res.arrayBuffer()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export async function whoami(token: string): Promise<{ login: string }> {
  return call(token, '/user');
}

export async function repoAccess(token: string, repo: RepoRef): Promise<{ push: boolean; private: boolean }> {
  const r = await call<{ permissions?: { push?: boolean }; private: boolean }>(token, `/repos/${repo.owner}/${repo.repo}`);
  return { push: !!r.permissions?.push, private: r.private };
}

/** Full recursive tree of a branch; an empty repository yields an empty list. */
export async function getTree(token: string, repo: RepoRef): Promise<{ commit: string | null; entries: TreeEntry[] }> {
  try {
    const ref = await call<{ object: { sha: string } }>(token, `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${repo.branch}`);
    const tree = await call<{ tree: TreeEntry[]; truncated: boolean }>(
      token,
      `/repos/${repo.owner}/${repo.repo}/git/trees/${ref.object.sha}?recursive=1`,
    );
    return { commit: ref.object.sha, entries: tree.tree.filter((e) => e.type === 'blob') };
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 409 || e.status === 404)) return { commit: null, entries: [] };
    throw e;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export async function getBlobText(token: string, repo: RepoRef, sha: string): Promise<string> {
  const blob = await call<{ content: string; encoding: string }>(token, `/repos/${repo.owner}/${repo.repo}/git/blobs/${sha}`);
  return new TextDecoder().decode(b64ToBytes(blob.content));
}

export async function getRawFile(token: string, repo: RepoRef, path: string): Promise<ArrayBuffer> {
  const p = path.split('/').map(encodeURIComponent).join('/');
  return call<ArrayBuffer>(token, `/repos/${repo.owner}/${repo.repo}/contents/${p}?ref=${encodeURIComponent(repo.branch)}`, {}, 'application/vnd.github.raw');
}

export interface FileChange {
  path: string;
  text?: string;
  bytes?: Uint8Array;
  delete?: boolean;
}

/** Commit several file changes atomically to a branch (creates the branch's first commit if the repo is empty). */
export async function commitFiles(token: string, repo: RepoRef, changes: FileChange[], message: string): Promise<string> {
  const base = `/repos/${repo.owner}/${repo.repo}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let headSha: string | null = null;
    let baseTree: string | undefined;
    try {
      const ref = await call<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${repo.branch}`);
      headSha = ref.object.sha;
      const commit = await call<{ tree: { sha: string } }>(token, `${base}/git/commits/${headSha}`);
      baseTree = commit.tree.sha;
    } catch (e) {
      if (!(e instanceof GitHubError && (e.status === 409 || e.status === 404))) throw e;
      // Empty repository: the Git Data API needs one commit first; the contents API can create it.
      const first = changes.find((c) => !c.delete);
      if (!first) return '';
      const content = first.bytes ? bytesToB64(first.bytes) : bytesToB64(new TextEncoder().encode(first.text ?? ''));
      await call(token, `${base}/contents/${first.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content, branch: repo.branch }),
      });
      changes = changes.filter((c) => c !== first);
      if (!changes.length) return '';
      continue;
    }
    const tree: Record<string, unknown>[] = [];
    for (const ch of changes) {
      if (ch.delete) {
        tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: null });
      } else if (ch.bytes) {
        const blob = await call<{ sha: string }>(token, `${base}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: bytesToB64(ch.bytes), encoding: 'base64' }),
        });
        tree.push({ path: ch.path, mode: '100644', type: 'blob', sha: blob.sha });
      } else {
        tree.push({ path: ch.path, mode: '100644', type: 'blob', content: ch.text ?? '' });
      }
    }
    const newTree = await call<{ sha: string }>(token, `${base}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });
    const commit = await call<{ sha: string }>(token, `${base}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: headSha ? [headSha] : [] }),
    });
    try {
      await call(token, `${base}/git/refs/heads/${repo.branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return commit.sha;
    } catch (e) {
      // Someone else pushed in between (e.g. the daily data job): rebuild on the new head.
      if (e instanceof GitHubError && (e.status === 422 || e.status === 409) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error('Could not commit after several attempts');
}

export async function dispatchWorkflow(token: string, repo: RepoRef, workflow: string, inputs: Record<string, string> = {}): Promise<void> {
  await call(token, `/repos/${repo.owner}/${repo.repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: repo.branch, inputs }),
  });
}

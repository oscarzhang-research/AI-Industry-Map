// Owner-mode storage: reads and writes the private vault repository and keeps the public repository's
// sanitized copies in sync. Parsed files are cached in this browser by git blob SHA, so later visits
// fetch only what changed (edits made by Claude sessions are picked up the same way).
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { commitFiles, getBlobText, getRawFile, getTree, type FileChange, type TreeEntry } from './github.ts';
import { parseRecordFile, publicProjection, recordPath, serializeRecord } from './records.ts';
import type { AnyRecord, ReportMeta, SiteConfig } from './types.ts';
import { storageGet, storageSet } from './settings.ts';

const CACHE_KEY = 'aim.vault.cache.v1';

interface CacheEntry {
  sha: string;
  kind: 'record' | 'report';
  data: AnyRecord | ReportMeta;
}

export interface VaultData {
  records: AnyRecord[];
  reports: ReportMeta[];
  vaultPaths: Map<string, string>; // path -> sha
  publicPaths: Map<string, string>;
  loadedAt: string;
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(storageGet(CACHE_KEY) || '{}') as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function writeCache(c: Record<string, CacheEntry>) {
  storageSet(CACHE_KEY, JSON.stringify(c));
}

export function clearVaultCache() {
  storageSet(CACHE_KEY, null);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

const isRecordPath = (p: string) => /^vault\/(theses|notes|journal|outlook)\/[^/]+\.md$/.test(p);
const isReportMeta = (p: string) => /^vault\/reports\/[^/]+\/meta\.yaml$/.test(p);

export async function loadVault(token: string, config: SiteConfig, onProgress?: (done: number, total: number) => void): Promise<VaultData> {
  const [vault, pub] = await Promise.all([getTree(token, config.repos.vault), getTree(token, config.repos.public)]);
  const cache = readCache();
  const next: Record<string, CacheEntry> = {};
  const wanted = vault.entries.filter((e) => isRecordPath(e.path) || isReportMeta(e.path));
  const toFetch = wanted.filter((e) => cache[e.path]?.sha !== e.sha);
  let done = 0;
  onProgress?.(0, toFetch.length);
  const fetched = await pool(toFetch, 8, async (e: TreeEntry) => {
    const text = await getBlobText(token, config.repos.vault, e.sha);
    done += 1;
    onProgress?.(done, toFetch.length);
    return { e, text };
  });
  for (const e of wanted) if (cache[e.path]?.sha === e.sha) next[e.path] = cache[e.path];
  for (const { e, text } of fetched) {
    try {
      if (isRecordPath(e.path)) {
        const rec = parseRecordFile(text, e.path);
        next[e.path] = { sha: e.sha, kind: 'record', data: rec };
      } else {
        const meta = parseYaml(text) as ReportMeta;
        const dir = e.path.slice(0, -'meta.yaml'.length);
        meta.url = `${dir}${meta.file || 'report.pdf'}`;
        next[e.path] = { sha: e.sha, kind: 'report', data: meta };
      }
    } catch (err) {
      console.warn('Skipping unreadable vault file', e.path, err);
    }
  }
  writeCache(next);
  const records: AnyRecord[] = [];
  const reports: ReportMeta[] = [];
  for (const [path, entry] of Object.entries(next)) {
    if (entry.kind === 'record') records.push({ ...(entry.data as AnyRecord), origin: 'vault', path });
    else reports.push({ ...(entry.data as ReportMeta), origin: 'vault', visibility: 'private' });
  }
  return {
    records,
    reports,
    vaultPaths: new Map(vault.entries.map((e) => [e.path, e.sha])),
    publicPaths: new Map(pub.entries.map((e) => [e.path, e.sha])),
    loadedAt: new Date().toISOString(),
  };
}

/** Save a record to the vault and publish/unpublish its sanitized copy in the public repo. */
export async function saveRecordToGitHub(
  token: string,
  config: SiteConfig,
  rec: AnyRecord,
  data: VaultData,
  previous?: AnyRecord,
): Promise<void> {
  const clean = { ...rec };
  delete (clean as { origin?: string }).origin;
  delete (clean as { path?: string }).path;
  const vaultPath = recordPath(clean, 'vault');
  const vchanges: FileChange[] = [{ path: vaultPath, text: serializeRecord(clean) }];
  if (previous && previous.type !== clean.type) {
    const old = recordPath(previous, 'vault');
    if (old !== vaultPath && data.vaultPaths.has(old)) vchanges.push({ path: old, delete: true });
  }
  await commitFiles(token, config.repos.vault, vchanges, `${clean.type}: ${clean.title || clean.id}`);
  data.vaultPaths.set(vaultPath, 'pending');

  const pubPath = recordPath(clean, 'content/views');
  const projection = publicProjection(clean, config.defaults.publicHiddenFields);
  if (projection) {
    await commitFiles(token, config.repos.public, [{ path: pubPath, text: serializeRecord(projection) }], `publish ${clean.type}: ${clean.title || clean.id}`);
    data.publicPaths.set(pubPath, 'pending');
  } else if (data.publicPaths.has(pubPath)) {
    await commitFiles(token, config.repos.public, [{ path: pubPath, delete: true }], `unpublish ${clean.type}: ${clean.id}`);
    data.publicPaths.delete(pubPath);
  }
}

export async function deleteRecordFromGitHub(token: string, config: SiteConfig, rec: AnyRecord, data: VaultData): Promise<void> {
  const vaultPath = recordPath(rec, 'vault');
  if (data.vaultPaths.has(vaultPath)) {
    await commitFiles(token, config.repos.vault, [{ path: vaultPath, delete: true }], `delete ${rec.type}: ${rec.id}`);
    data.vaultPaths.delete(vaultPath);
  }
  const pubPath = recordPath(rec, 'content/views');
  if (data.publicPaths.has(pubPath)) {
    await commitFiles(token, config.repos.public, [{ path: pubPath, delete: true }], `unpublish ${rec.type}: ${rec.id}`);
    data.publicPaths.delete(pubPath);
  }
}

export interface UploadInput {
  file: File;
  meta: ReportMeta;
}

/**
 * Upload a report. PDFs and private HTML go to the vault (vault/reports/<id>/); public HTML research goes to
 * the public repo (content/reports/<id>/), where the site build picks it up.
 */
export async function uploadReport(token: string, config: SiteConfig, input: UploadInput): Promise<ReportMeta> {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const isPdf = input.meta.format === 'pdf';
  const meta: ReportMeta = { ...input.meta, file: isPdf ? 'report.pdf' : 'report.html', size: bytes.length };
  delete meta.url;
  delete meta.origin;
  const goesPublic = !isPdf && meta.visibility === 'public' && meta.kind !== 'sell-side';
  const root = goesPublic ? 'content/reports' : 'vault/reports';
  const repo = goesPublic ? config.repos.public : config.repos.vault;
  const metaYaml = stringifyYaml(meta, { lineWidth: 0 });
  await commitFiles(
    token,
    repo,
    [
      { path: `${root}/${meta.id}/${meta.file}`, bytes },
      { path: `${root}/${meta.id}/meta.yaml`, text: metaYaml },
    ],
    `report: ${meta.title}`,
  );
  return { ...meta, origin: goesPublic ? 'public' : 'vault', url: goesPublic ? undefined : `${root}/${meta.id}/${meta.file}` };
}

export async function updateVaultReportMeta(token: string, config: SiteConfig, meta: ReportMeta): Promise<void> {
  const clean = { ...meta };
  const dir = `vault/reports/${clean.id}/`;
  delete clean.url;
  delete clean.origin;
  await commitFiles(token, config.repos.vault, [{ path: `${dir}meta.yaml`, text: stringifyYaml(clean, { lineWidth: 0 }) }], `report meta: ${clean.id}`);
}

/** Download a private file (e.g. a sell-side PDF) and return an object URL for viewing. */
export async function vaultFileUrl(token: string, config: SiteConfig, path: string, type = 'application/pdf'): Promise<string> {
  const buf = await getRawFile(token, config.repos.vault, path);
  return URL.createObjectURL(new Blob([buf], { type }));
}

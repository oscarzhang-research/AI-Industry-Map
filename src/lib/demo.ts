// Demo mode: lets anyone try the editor without a GitHub token. Records live in this browser only.
import type { AnyRecord } from './types.ts';
import { storageGet, storageSet } from './settings.ts';

const KEY = 'aim.demo.records.v1';
let memory: AnyRecord[] | null = null;

export function loadDemoRecords(): AnyRecord[] {
  if (memory) return memory;
  try {
    memory = (JSON.parse(storageGet(KEY) || '[]') as AnyRecord[]).map((r) => ({ ...r, origin: 'demo' as const }));
  } catch {
    memory = [];
  }
  return memory;
}

function persist(list: AnyRecord[]) {
  memory = list;
  storageSet(KEY, JSON.stringify(list));
}

export function saveDemoRecord(rec: AnyRecord): AnyRecord[] {
  const list = loadDemoRecords().filter((r) => r.id !== rec.id);
  list.push({ ...rec, origin: 'demo' });
  persist(list);
  return list;
}

export function deleteDemoRecord(id: string): AnyRecord[] {
  const list = loadDemoRecords().filter((r) => r.id !== id);
  persist(list);
  return list;
}

export function clearDemo(): void {
  persist([]);
}

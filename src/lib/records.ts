import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AnyRecord, ThesisRecord, RecordType, Translation } from './types.ts';

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse a Markdown file with YAML front matter into a record. */
export function parseRecordFile(text: string, path?: string): AnyRecord {
  const m = FM.exec(text);
  if (!m) throw new Error(`Missing front matter${path ? ` in ${path}` : ''}`);
  const data = (parseYaml(m[1]) || {}) as Record<string, unknown>;
  const body = m[2].replace(/^\s*\n/, '').replace(/\s+$/, '');
  const rec = { ...data } as unknown as AnyRecord;
  if (body) rec.body = body;
  if (path) rec.path = path;
  normalizeDates(rec as unknown as Record<string, unknown>);
  return rec;
}

/** Serialize a record to Markdown with YAML front matter (stable key order, no derived fields). */
export function serializeRecord(rec: AnyRecord): string {
  const { body, origin: _o, path: _p, ...data } = rec as AnyRecord & { origin?: string; path?: string };
  void _o;
  void _p;
  const ordered = orderKeys(data as Record<string, unknown>);
  const yaml = stringifyYaml(ordered, { lineWidth: 0, blockQuote: 'literal' }).trimEnd();
  return `---\n${yaml}\n---\n${body ? `\n${body.trim()}\n` : ''}`;
}

const KEY_ORDER = [
  'id', 'type', 'title', 'visibility', 'example', 'lang', 'createdAt', 'updatedAt', 'status',
  'subject', 'subjects', 'period', 'direction', 'conviction', 'horizonMonths', 'targetDate',
  'basePrice', 'refClose', 'target', 'stop', 'scenarios', 'summary', 'logic', 'variant', 'bearCase',
  'valuation', 'consensus', 'catalysts', 'signals', 'risks', 'updates', 'plan', 'position', 'related',
  'reports', 'benchmark', 'reviewOn', 'closed', 'review', 'bottleneck', 'layerStances', 'cycleView',
  'history', 'links', 'source', 'tags', 'publicShow', 'backfilled', 'versions', 'translation',
];

function orderKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEY_ORDER) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** YAML parses unquoted dates as strings with the default schema in `yaml`; keep them as ISO strings. */
function normalizeDates(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Date) obj[k] = v.toISOString();
    else if (v && typeof v === 'object' && !Array.isArray(v)) normalizeDates(v as Record<string, unknown>);
    else if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && normalizeDates(x as Record<string, unknown>));
  }
}

export const RECORD_DIRS: Record<RecordType, string> = {
  thesis: 'theses',
  note: 'notes',
  journal: 'journal',
  outlook: 'outlook',
};

export function recordPath(rec: Pick<AnyRecord, 'type' | 'id'>, root: 'content/views' | 'vault'): string {
  return `${root}/${RECORD_DIRS[rec.type]}/${rec.id}.md`;
}

const PREFIX: Record<RecordType, string> = { thesis: 'th', note: 'nt', journal: 'jr', outlook: 'ol' };

export function slugify(text: string, max = 40): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function newRecordId(type: RecordType, hint: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const slug = slugify(hint) || Math.random().toString(36).slice(2, 8);
  return `${PREFIX[type]}-${day}-${slug}`;
}

export function hasCJK(text: string | undefined): boolean {
  return !!text && /[㐀-鿿豈-﫿]/.test(text);
}

// ---------------------------------------------------------------------------
// Translation support: every user-written text field gets a stable key.
// ---------------------------------------------------------------------------

type Dict = Record<string, string>;

function put(out: Dict, key: string, v: unknown) {
  if (typeof v === 'string' && v.trim()) out[key] = v;
}

/** All translatable text of a record, keyed by a stable path. */
export function translatableFields(rec: AnyRecord): Dict {
  const out: Dict = {};
  put(out, 'title', rec.title);
  put(out, 'body', rec.body);
  if (rec.type === 'thesis') {
    const t = rec as ThesisRecord;
    for (const k of ['summary', 'logic', 'variant', 'bearCase', 'valuation', 'consensus', 'plan', 'position', 'review'] as const) {
      put(out, k, t[k]);
    }
    put(out, 'target.method', t.target?.method);
    put(out, 'stop.note', t.stop?.note);
    t.catalysts?.forEach((c) => {
      put(out, `catalysts.${c.id}.label`, c.label);
      put(out, `catalysts.${c.id}.note`, c.note);
    });
    t.signals?.forEach((s) => {
      put(out, `signals.${s.id}.text`, s.text);
      put(out, `signals.${s.id}.note`, s.note);
    });
    t.risks?.forEach((r) => {
      put(out, `risks.${r.id}.text`, r.text);
      put(out, `risks.${r.id}.trigger`, r.trigger);
      put(out, `risks.${r.id}.note`, r.note);
    });
    t.updates?.forEach((u, i) => put(out, `updates.${i}.text`, u.text));
    t.scenarios?.forEach((s, i) => put(out, `scenarios.${i}.note`, s.note));
    t.related?.forEach((r, i) => put(out, `related.${i}.note`, r.note));
    t.versions?.forEach((v, i) => put(out, `versions.${i}.reason`, v.reason));
    put(out, 'closed.reason', t.closed?.reason);
  } else if (rec.type === 'note') {
    put(out, 'source.label', rec.source?.label);
  } else if (rec.type === 'outlook') {
    put(out, 'cycleView', rec.cycleView);
    put(out, 'bottleneck.label', rec.bottleneck?.label);
    put(out, 'bottleneck.note', rec.bottleneck?.note);
    for (const [layer, st] of Object.entries(rec.layerStances || {})) put(out, `layerStances.${layer}.note`, st?.note);
    rec.history?.forEach((h, i) => {
      put(out, `history.${i}.label`, h.label);
      put(out, `history.${i}.note`, h.note);
    });
  }
  return out;
}

/** FNV-1a 32-bit hash; sync and identical in Node and browsers. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sourceHash(fields: Dict): string {
  return fnv1a(
    Object.keys(fields)
      .sort()
      .map((k) => `${k}\u0000${fields[k]}`)
      .join('\u0001'),
  );
}

export function recordLanguage(rec: AnyRecord): 'en' | 'zh' {
  if (rec.lang) return rec.lang;
  return Object.values(translatableFields(rec)).some(hasCJK) ? 'zh' : 'en';
}

export type TranslationState = 'original-en' | 'translated' | 'stale' | 'pending';

export function translationState(rec: AnyRecord): TranslationState {
  if (recordLanguage(rec) === 'en') return 'original-en';
  const tr = rec.translation;
  if (!tr) return 'pending';
  return tr.sourceHash === sourceHash(translatableFields(rec)) ? 'translated' : 'stale';
}

/** Return a copy with English text swapped in where a translation exists. */
export function withTranslation<T extends AnyRecord>(rec: T): T {
  const tr: Translation | undefined = rec.translation;
  if (!tr || recordLanguage(rec) === 'en') return rec;
  const copy = structuredClone(rec) as T & Record<string, unknown>;
  for (const [key, value] of Object.entries(tr.fields)) setPath(copy, key, value);
  return copy;
}

function setPath(obj: Record<string, unknown>, key: string, value: string) {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(cur)) {
      const byId = (cur as { id?: string }[]).find((x) => x && x.id === p);
      cur = byId ?? (cur as unknown[])[Number(p)];
    } else if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return;
    }
    if (cur === undefined || cur === null) return;
  }
  const last = parts[parts.length - 1];
  if (cur && typeof cur === 'object') (cur as Record<string, unknown>)[last] = value;
}

// ---------------------------------------------------------------------------
// Public projection: what a visitor may see of a record.
// ---------------------------------------------------------------------------

export const HIDEABLE_THESIS_FIELDS = ['target', 'stop', 'scenarios', 'plan', 'position'] as const;
export type HideableField = (typeof HIDEABLE_THESIS_FIELDS)[number];

export function hiddenFieldsFor(rec: ThesisRecord, defaults: string[]): HideableField[] {
  return HIDEABLE_THESIS_FIELDS.filter((f) => defaults.includes(f) && !rec.publicShow?.[f]);
}

/** Sanitized copy for the public repo, or null if the record is private. */
export function publicProjection(rec: AnyRecord, defaultHidden: string[]): AnyRecord | null {
  if (rec.visibility !== 'public') return null;
  const freshTranslation = translationState(rec) === 'translated';
  const copy = structuredClone(rec) as AnyRecord & { origin?: string; path?: string };
  delete copy.origin;
  delete copy.path;
  if (copy.type === 'thesis') {
    const t = copy as ThesisRecord;
    const hidden = hiddenFieldsFor(t, defaultHidden);
    for (const f of hidden) delete (t as unknown as Record<string, unknown>)[f];
    if (hidden.includes('target') || hidden.includes('stop')) {
      t.versions = t.versions?.map((v) => {
        const nv = { ...v };
        if (hidden.includes('target')) delete nv.target;
        if (hidden.includes('stop')) delete nv.stop;
        return nv;
      });
    }
    if (hidden.includes('target') && t.closed) delete t.closed.price;
    // Translation keys of removed fields must not leak either.
    if (t.translation) {
      const drop = new Set<string>(hidden.flatMap((f) => (f === 'target' ? ['target.method'] : f === 'stop' ? ['stop.note'] : [f])));
      t.translation = {
        ...t.translation,
        fields: Object.fromEntries(
          Object.entries(t.translation.fields).filter(([k]) => !drop.has(k) && !(hidden.includes('scenarios') && k.startsWith('scenarios.'))),
        ),
      };
    }
  }
  // Removing hidden fields changes the source text; keep an up-to-date translation marked as such.
  if (copy.translation && freshTranslation) copy.translation = { ...copy.translation, sourceHash: sourceHash(translatableFields(copy)) };
  return copy;
}

/** Fields whose change counts as a material revision of a thesis (creates a new version). */
export function materialChange(prev: ThesisRecord | undefined, next: ThesisRecord): string[] {
  if (!prev) return [];
  const changed: string[] = [];
  if (prev.direction !== next.direction) changed.push('direction');
  if ((prev.conviction ?? null) !== (next.conviction ?? null)) changed.push('conviction');
  if ((prev.target?.price ?? null) !== (next.target?.price ?? null)) changed.push('target');
  if ((prev.stop?.price ?? null) !== (next.stop?.price ?? null)) changed.push('stop');
  if ((prev.horizonMonths ?? null) !== (next.horizonMonths ?? null)) changed.push('horizon');
  return changed;
}

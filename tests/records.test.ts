import { describe, expect, it } from 'vitest';
import {
  materialChange,
  newRecordId,
  parseRecordFile,
  publicProjection,
  recordLanguage,
  serializeRecord,
  slugify,
  sourceHash,
  translatableFields,
  translationState,
  withTranslation,
} from '../src/lib/records.ts';
import type { NoteRecord, ThesisRecord } from '../src/lib/types.ts';

const HIDDEN = ['target', 'stop', 'scenarios', 'plan', 'position'];

function thesis(extra: Partial<ThesisRecord> = {}): ThesisRecord {
  return {
    id: 'th-2026-10-01-mu-long',
    type: 'thesis',
    visibility: 'public',
    createdAt: '2026-10-01T13:00:00.000Z',
    subject: { kind: 'company', company: 'micron' },
    direction: 'long',
    conviction: 3,
    summary: 'HBM pricing holds through 2027.',
    status: 'active',
    target: { price: 1300, method: 'multiple' },
    stop: { price: 900 },
    scenarios: [{ name: 'bull', price: 1500, prob: 0.3, note: 'tight' }],
    plan: 'Build in thirds.',
    position: 'Small.',
    versions: [{ at: '2026-10-01T13:00:00.000Z', target: 1300, stop: 900, reason: 'Opened' }],
    ...extra,
  };
}

describe('serialize and parse', () => {
  it('round-trips front matter and body', () => {
    const t = thesis({ body: '## Notes\n\nSome **markdown**.' });
    const text = serializeRecord(t);
    expect(text.startsWith('---\nid: th-2026-10-01-mu-long\ntype: thesis\n')).toBe(true);
    const back = parseRecordFile(text, 'vault/theses/x.md');
    expect(back.body).toBe(t.body);
    expect((back as ThesisRecord).target?.price).toBe(1300);
    expect(back.path).toBe('vault/theses/x.md');
    expect(back.createdAt).toBe(t.createdAt); // dates stay ISO strings
  });

  it('drops derived fields when writing', () => {
    const text = serializeRecord({ ...thesis(), origin: 'vault', path: 'x' });
    expect(text).not.toMatch(/origin:|path:/);
  });
});

describe('translation', () => {
  const zh: NoteRecord = {
    id: 'nt-1',
    type: 'note',
    visibility: 'public',
    createdAt: '2026-10-08T00:00:00.000Z',
    subjects: [],
    title: '台积电营收',
    body: '同比增长54.6%。',
  };

  it('detects Chinese and reports a missing translation as pending', () => {
    expect(recordLanguage(zh)).toBe('zh');
    expect(translationState(zh)).toBe('pending');
  });

  it('marks a translation stale when the source changes', () => {
    const tr = { ...zh, translation: { lang: 'en' as const, fields: { title: 'TSMC revenue', body: 'Up 54.6%.' }, sourceHash: sourceHash(translatableFields(zh)), translatedAt: 'x' } };
    expect(translationState(tr)).toBe('translated');
    expect(withTranslation(tr).title).toBe('TSMC revenue');
    expect(translationState({ ...tr, body: '同比增长55%。' })).toBe('stale');
  });

  it('addresses list items by id', () => {
    const t = thesis({
      summary: '看多',
      signals: [{ id: 's1', text: '价格上涨', status: 'pending' }],
    });
    const fields = translatableFields(t);
    expect(fields['signals.s1.text']).toBe('价格上涨');
    const tr = { ...t, translation: { lang: 'en' as const, fields: { summary: 'Long', 'signals.s1.text': 'Prices rise' }, sourceHash: sourceHash(fields), translatedAt: 'x' } };
    const en = withTranslation(tr);
    expect(en.summary).toBe('Long');
    expect(en.signals?.[0].text).toBe('Prices rise');
    expect(t.signals?.[0].text).toBe('价格上涨'); // the original is untouched
  });
});

describe('publicProjection', () => {
  it('returns nothing for private records', () => {
    expect(publicProjection(thesis({ visibility: 'private' }), HIDDEN)).toBeNull();
  });

  it('hides sensitive fields unless shown per thesis', () => {
    const p = publicProjection(thesis(), HIDDEN) as ThesisRecord;
    expect(p.target).toBeUndefined();
    expect(p.stop).toBeUndefined();
    expect(p.scenarios).toBeUndefined();
    expect(p.plan).toBeUndefined();
    expect(p.position).toBeUndefined();
    expect(p.versions?.[0].target).toBeUndefined();
    expect(p.summary).toBe('HBM pricing holds through 2027.');
    const shown = publicProjection(thesis({ publicShow: { target: true } }), HIDDEN) as ThesisRecord;
    expect(shown.target?.price).toBe(1300);
    expect(shown.versions?.[0].target).toBe(1300);
    expect(shown.stop).toBeUndefined();
  });

  it('keeps an up-to-date translation up to date after hiding fields', () => {
    const t = thesis({ summary: '看多存储', plan: '分三次建仓' });
    const fields = translatableFields(t);
    const tr = { ...t, translation: { lang: 'en' as const, fields: { summary: 'Long memory', plan: 'Build in thirds' }, sourceHash: sourceHash(fields), translatedAt: 'x' } };
    const p = publicProjection(tr, HIDDEN) as ThesisRecord;
    expect(p.translation?.fields.plan).toBeUndefined(); // hidden text does not leak through the translation
    expect(translationState(p)).toBe('translated');
  });
});

describe('materialChange', () => {
  it('lists changed core fields only', () => {
    const a = thesis();
    expect(materialChange(a, { ...a, summary: 'changed' })).toEqual([]);
    expect(materialChange(a, { ...a, target: { price: 1400 }, conviction: 4 })).toEqual(['conviction', 'target']);
    expect(materialChange(undefined, a)).toEqual([]);
  });
});

describe('ids', () => {
  it('builds dated slugs', () => {
    expect(slugify('SK hynix: HBM4 — long!')).toBe('sk-hynix-hbm4-long');
    expect(newRecordId('thesis', 'MU long', new Date('2026-10-02T12:00:00Z'))).toBe('th-2026-10-02-mu-long');
  });
});

import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { DeleteButton, Modal } from './Modal.tsx';
import { RichText } from './RichText.tsx';
import { Field, TagInput } from './fields.tsx';
import { periodFor, prune, uniqueId } from './util.ts';
import { newRecordId } from '../lib/records.ts';
import { display } from '../lib/views.ts';
import { fmtDate, todayISO } from '../lib/format.ts';
import type { JournalRecord } from '../lib/types.ts';

type Kind = JournalRecord['period']['kind'];

export default function JournalEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const { site, allRecords, saveRecord, deleteRecord, toast } = useStore();
  const today = todayISO(site.config.site.timezone);
  const existing = id ? (allRecords.find((r) => r.id === id && r.type === 'journal') as JournalRecord | undefined) : undefined;
  const [form, setForm] = useState<JournalRecord>(() =>
    existing
      ? structuredClone(existing)
      : { id: '', type: 'journal', visibility: site.config.defaults.newRecordVisibility, createdAt: new Date().toISOString(), period: { kind: 'week', ...periodFor('week', today) }, body: weeklyTemplate(), tags: [] },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const initial = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== initial.current;
  const set = (patch: Partial<JournalRecord>) => setForm((f) => ({ ...f, ...patch }));

  // Records written during the period, offered as links.
  const candidates = useMemo(
    () =>
      allRecords
        .filter((r) => (r.type === 'thesis' || r.type === 'note') && r.id !== form.id)
        .filter((r) => {
          const d = (r.updatedAt ?? r.createdAt).slice(0, 10);
          return (d >= form.period.start && d <= form.period.end) || form.links?.includes(r.id);
        })
        .slice(0, 60),
    [allRecords, form.period, form.links, form.id],
  );

  const save = async () => {
    setError(undefined);
    if (!form.body?.trim()) return setError('Write the review first.');
    let rec = { ...form };
    if (!existing) rec.id = uniqueId(newRecordId('journal', `${form.period.kind}-${form.period.end}`, new Date(rec.createdAt)), allRecords);
    rec = prune(rec);
    setSaving(true);
    try {
      await saveRecord(rec, existing);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit journal entry' : 'New journal entry'}
      sub="A weekly, fortnightly or monthly review. The template is only a starting point."
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          {existing ? <DeleteButton label="Delete entry" onDelete={() => deleteRecord(existing).then(onClose, (e: Error) => toast(e.message, 'error'))} /> : null}
          {error ? (
            <span className="down" style={{ fontSize: 'var(--step--1)', marginRight: 'auto' }}>
              {error}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save entry'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <div className="editor-grid">
          <Field label="Period">
            <Segmented
              label="Period"
              value={form.period.kind}
              onChange={(kind: Kind) => set({ period: { kind, ...periodFor(kind, today) } })}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'fortnight', label: 'Two weeks' },
                { value: 'month', label: 'Month' },
                { value: 'quarter', label: 'Quarter' },
              ]}
            />
          </Field>
          <Field label="Dates">
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input className="input" type="date" value={form.period.start} onChange={(e) => set({ period: { ...form.period, start: e.target.value } })} aria-label="Start" />
              <span className="muted">to</span>
              <input className="input" type="date" value={form.period.end} onChange={(e) => set({ period: { ...form.period, end: e.target.value } })} aria-label="End" />
            </div>
          </Field>
          <Field label="Title" className="full" htmlFor="jr-title" hint={`e.g. “Memory tightens again; power names digest” · ${fmtDate(form.period.start)} – ${fmtDate(form.period.end)}`}>
            <input id="jr-title" className="input" value={form.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />
          </Field>
        </div>
        <Field label="Review">
          <RichText value={form.body} onChange={(body) => set({ body })} minHeight={260} />
        </Field>
        {candidates.length ? (
          <Field label="Link views and notes from this period">
            <div className="picklist">
              {candidates.map((r) => {
                const d = display(r);
                return (
                  <label key={r.id}>
                    <input type="checkbox" checked={form.links?.includes(r.id) ?? false} onChange={(e) => set({ links: e.target.checked ? [...(form.links ?? []), r.id] : (form.links ?? []).filter((x) => x !== r.id) })} />
                    <span className="min0">
                      <span className="badge" style={{ marginRight: 6 }}>
                        {r.type === 'thesis' ? 'View' : 'Note'}
                      </span>
                      {d.title || (d.type === 'thesis' ? d.summary : d.body?.slice(0, 90))}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}
        <div className="editor-grid">
          <Field label="Tags" htmlFor="jr-tags">
            <TagInput id="jr-tags" value={form.tags ?? []} onChange={(tags) => set({ tags })} />
          </Field>
          <Field label="Visibility">
            <Segmented
              label="Visibility"
              value={form.visibility}
              onChange={(v) => set({ visibility: v })}
              options={[
                { value: 'private', label: 'Private' },
                { value: 'public', label: 'Public' },
              ]}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function weeklyTemplate(): string {
  return [
    '## What changed',
    '',
    '- ',
    '',
    '## Where the bottleneck moved',
    '',
    '',
    '## My views: confirmed, challenged, changed',
    '',
    '- ',
    '',
    '## Next period: what I am watching',
    '',
    '- ',
  ].join('\n');
}

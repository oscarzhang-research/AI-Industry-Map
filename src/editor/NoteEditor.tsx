import { useRef, useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { DeleteButton, Modal } from './Modal.tsx';
import { RichText } from './RichText.tsx';
import { CompanyMulti, Field, NodeMulti, TagInput } from './fields.tsx';
import { prune, uniqueId } from './util.ts';
import { newRecordId } from '../lib/records.ts';
import { fmtDate } from '../lib/format.ts';
import type { NoteRecord, Subject } from '../lib/types.ts';

type SourceKind = NonNullable<NoteRecord['source']>['kind'];

export default function NoteEditor({ id, preset, onClose }: { id?: string; preset?: Record<string, unknown>; onClose: () => void }) {
  const { site, allRecords, allReports, saveRecord, deleteRecord, toast } = useStore();
  const existing = id ? (allRecords.find((r) => r.id === id && r.type === 'note') as NoteRecord | undefined) : undefined;
  const [form, setForm] = useState<NoteRecord>(() => (existing ? structuredClone(existing) : initialNote(preset, site.config.defaults.newRecordVisibility)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const initial = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== initial.current;
  const set = (patch: Partial<NoteRecord>) => setForm((f) => ({ ...f, ...patch }));

  const companies = form.subjects.filter((s) => s.kind === 'company' && s.company).map((s) => s.company!);
  const nodes = form.subjects.filter((s) => s.kind === 'node' && s.node).map((s) => s.node!);
  const themes = form.subjects.filter((s) => s.kind === 'theme' && s.theme).map((s) => s.theme!);
  const setSubjects = (c: string[], n: string[], t: string[]) =>
    set({
      subjects: [
        ...c.map((company): Subject => ({ kind: 'company', company })),
        ...n.map((node): Subject => ({ kind: 'node', node })),
        ...t.map((theme): Subject => ({ kind: 'theme', theme })),
      ],
    });

  const save = async () => {
    setError(undefined);
    if (!form.body?.trim() && !form.title?.trim()) return setError('Write something first.');
    let rec = { ...form };
    if (!existing) {
      const hint = form.title || (companies[0] && site.companies[companies[0]]?.symbol) || nodes[0]?.split('/').pop() || 'note';
      rec.id = uniqueId(newRecordId('note', hint, new Date(rec.createdAt)), allRecords);
    }
    rec = prune(rec);
    if (!rec.subjects) rec.subjects = [];
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
      title={existing ? 'Edit note' : 'New note'}
      sub={existing ? `Written ${fmtDate(existing.createdAt)}` : 'A quick thought, a takeaway from news or research. Chinese is fine.'}
      dirty={dirty}
      onClose={onClose}
      wide={false}
      footer={
        <>
          {existing ? (
            <DeleteButton
              label="Delete note"
              onDelete={() =>
                deleteRecord(existing).then(onClose, (e: Error) => {
                  toast(e.message, 'error');
                })
              }
            />
          ) : null}
          {error ? (
            <span className="down" style={{ fontSize: 'var(--step--1)', marginRight: 'auto' }}>
              {error}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <Field label="Title (optional)" htmlFor="nt-title">
          <input id="nt-title" className="input" value={form.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />
        </Field>
        <Field label="Note">
          <RichText value={form.body} onChange={(body) => set({ body })} placeholder="What happened, and what it means." minHeight={150} />
        </Field>
        <div className="editor-grid">
          <Field label="Companies" htmlFor="nt-co">
            <CompanyMulti id="nt-co" value={companies} onChange={(c) => setSubjects(c, nodes, themes)} />
          </Field>
          <Field label="Industries" htmlFor="nt-nodes">
            <NodeMulti id="nt-nodes" value={nodes} onChange={(n) => setSubjects(companies, n, themes)} />
          </Field>
          <Field label="Themes" htmlFor="nt-themes" className="full">
            <div className="row" style={{ gap: 4 }}>
              {site.themes.map((t) => (
                <label key={t.id} className="checkbox" style={{ marginRight: 10 }}>
                  <input type="checkbox" checked={themes.includes(t.id)} onChange={(e) => setSubjects(companies, nodes, e.target.checked ? [...themes, t.id] : themes.filter((x) => x !== t.id))} />
                  {t.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Source" htmlFor="nt-src">
            <select id="nt-src" className="select" value={form.source?.kind ?? ''} onChange={(e) => set({ source: { ...form.source, kind: (e.target.value || undefined) as SourceKind } })}>
              <option value="">None</option>
              <option value="news">News</option>
              <option value="report">Research report</option>
              <option value="call">Earnings call</option>
              <option value="meeting">Meeting or conversation</option>
              <option value="other">Other</option>
            </select>
          </Field>
          {form.source?.kind === 'report' ? (
            <Field label="Report" htmlFor="nt-report">
              <select id="nt-report" className="select" value={form.source?.reportId ?? ''} onChange={(e) => set({ source: { ...form.source, reportId: e.target.value || undefined } })}>
                <option value="">Choose…</option>
                {allReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
          ) : form.source?.kind ? (
            <Field label="Link (optional)" htmlFor="nt-url">
              <input id="nt-url" className="input" value={form.source?.url ?? ''} placeholder="https://" onChange={(e) => set({ source: { ...form.source, url: e.target.value || undefined } })} />
            </Field>
          ) : (
            <span />
          )}
          <Field label="Tags" className="full" htmlFor="nt-tags">
            <TagInput id="nt-tags" value={form.tags ?? []} onChange={(tags) => set({ tags })} />
          </Field>
          <Field label="Date" htmlFor="nt-date">
            <input id="nt-date" className="input" type="date" value={form.createdAt.slice(0, 10)} onChange={(e) => e.target.value && set({ createdAt: `${e.target.value}T${form.createdAt.slice(11) || '12:00:00.000Z'}` })} />
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

function initialNote(preset: Record<string, unknown> | undefined, visibility: NoteRecord['visibility']): NoteRecord {
  const p = preset ?? {};
  const subjects: Subject[] = Array.isArray(p.subjects) ? (p.subjects as Subject[]) : p.subject ? [p.subject as Subject] : [];
  const rec: NoteRecord = { id: '', type: 'note', visibility, createdAt: new Date().toISOString(), subjects, tags: Array.isArray(p.tags) ? (p.tags as string[]) : [] };
  if (typeof p.title === 'string') rec.title = p.title;
  if (typeof p.body === 'string') rec.body = p.body;
  if (p.source && typeof p.source === 'object') rec.source = p.source as NoteRecord['source'];
  return rec;
}

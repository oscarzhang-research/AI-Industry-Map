import { useRef, useState } from 'react';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { DeleteButton, Modal } from './Modal.tsx';
import { RichText } from './RichText.tsx';
import { Field, NodeSelect } from './fields.tsx';
import { prune, uniqueId } from './util.ts';
import { newRecordId } from '../lib/records.ts';
import { latestOutlook } from '../lib/views.ts';
import { LAYER_CODE } from '../lib/format.ts';
import type { Direction, LayerId, OutlookRecord } from '../lib/types.ts';

/**
 * The outlook is a dated snapshot: "Update outlook" starts from the latest one and saves a new record,
 * so earlier calls stay in the history. "Edit" on the journal page changes the latest snapshot in place.
 */
export default function OutlookEditor({ id, onClose }: { id?: string; onClose: () => void }) {
  const { site, allRecords, saveRecord, deleteRecord, toast } = useStore();
  const existing = id ? (allRecords.find((r) => r.id === id && r.type === 'outlook') as OutlookRecord | undefined) : undefined;
  const [form, setForm] = useState<OutlookRecord>(() => {
    if (existing) return structuredClone(existing);
    const prev = latestOutlook(allRecords);
    const base: OutlookRecord = {
      id: '',
      type: 'outlook',
      visibility: prev?.visibility ?? site.config.defaults.newRecordVisibility,
      createdAt: new Date().toISOString(),
      title: 'Outlook',
      layerStances: prev?.layerStances ? structuredClone(prev.layerStances) : {},
      bottleneck: prev?.bottleneck ? structuredClone(prev.bottleneck) : undefined,
      cycleView: prev?.cycleView,
      body: prev?.body,
    };
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const initial = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== initial.current;
  const set = (patch: Partial<OutlookRecord>) => setForm((f) => ({ ...f, ...patch }));
  const setStance = (l: LayerId, patch: Partial<{ direction: Direction; conviction?: number; note?: string }>) =>
    setForm((f) => ({ ...f, layerStances: { ...f.layerStances, [l]: { direction: 'neutral', ...f.layerStances?.[l], ...patch } } }));

  const save = async () => {
    setError(undefined);
    let rec = { ...form };
    if (rec.bottleneck && !rec.bottleneck.label?.trim()) return setError('Name the bottleneck, or clear its industry.');
    if (!existing) rec.id = uniqueId(newRecordId('outlook', 'outlook', new Date(rec.createdAt)), allRecords);
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
      title={existing ? 'Edit outlook' : 'Update outlook'}
      sub={existing ? 'Changes this snapshot in place.' : 'Starts from your latest outlook and saves a new dated snapshot.'}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          {existing ? <DeleteButton label="Delete snapshot" onDelete={() => deleteRecord(existing).then(onClose, (e: Error) => toast(e.message, 'error'))} /> : null}
          {error ? (
            <span className="down" style={{ fontSize: 'var(--step--1)', marginRight: 'auto' }}>
              {error}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save outlook'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
        <div className="editor-grid">
          <Field label="Where the bottleneck sits" htmlFor="ol-node">
            <NodeSelect
              id="ol-node"
              value={form.bottleneck?.node}
              emptyLabel="No call"
              onChange={(node) => set({ bottleneck: node ? { label: form.bottleneck?.label ?? '', note: form.bottleneck?.note, node } : undefined })}
            />
          </Field>
          <Field label="In a few words" htmlFor="ol-label">
            <input id="ol-label" className="input" disabled={!form.bottleneck} value={form.bottleneck?.label ?? ''} placeholder="e.g. HBM and CoWoS capacity" onChange={(e) => form.bottleneck && set({ bottleneck: { ...form.bottleneck, label: e.target.value } })} />
          </Field>
          <Field label="Why" className="full" htmlFor="ol-note">
            <textarea id="ol-note" className="textarea" style={{ minHeight: 56 }} disabled={!form.bottleneck} value={form.bottleneck?.note ?? ''} onChange={(e) => form.bottleneck && set({ bottleneck: { ...form.bottleneck, note: e.target.value || undefined } })} />
          </Field>
        </div>

        <Field label="Stance by layer">
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            {site.layers
              .slice()
              .sort((a, b) => b.order - a.order)
              .map((l) => {
                const st = form.layerStances?.[l.id];
                return (
                  <div key={l.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <b style={{ width: 150, fontSize: 'var(--step--1)' }}>
                      {LAYER_CODE[l.id]} {l.name}
                    </b>
                    <Segmented
                      label={`${l.name} stance`}
                      value={st?.direction ?? 'neutral'}
                      onChange={(direction: Direction) => setStance(l.id, { direction })}
                      options={[
                        { value: 'long', label: 'Positive' },
                        { value: 'neutral', label: 'Neutral' },
                        { value: 'short', label: 'Negative' },
                        { value: 'watch', label: 'Watching' },
                      ]}
                    />
                    <input className="input" style={{ flex: 1, minWidth: 180 }} value={st?.note ?? ''} placeholder="One line on why" onChange={(e) => setStance(l.id, { note: e.target.value || undefined })} aria-label={`${l.name} note`} />
                  </div>
                );
              })}
          </div>
        </Field>

        <Field label="Cycle view" hint="Where are we in the AI capex and supply cycle?">
          <RichText value={form.cycleView} onChange={(cycleView) => set({ cycleView: cycleView || undefined })} />
        </Field>
        <Field label="More (optional)">
          <RichText value={form.body} onChange={(body) => set({ body: body || undefined })} />
        </Field>
        <Field label="Visibility">
          <Segmented
            label="Visibility"
            value={form.visibility}
            onChange={(v) => set({ visibility: v })}
            options={[
              { value: 'private', label: 'Private' },
              { value: 'public', label: 'Public (shown on the home page)' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}

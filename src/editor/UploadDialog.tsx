import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { Modal } from './Modal.tsx';
import { CompanyMulti, Field, NodeMulti, numOrUndef, TagInput } from './fields.tsx';
import { hasCJK, slugify } from '../lib/records.ts';
import { todayISO } from '../lib/format.ts';
import type { ReportMeta } from '../lib/types.ts';

const MAX_BYTES = 45 * 1024 * 1024;

export default function UploadDialog({ onClose }: { onClose: () => void }) {
  const { site, allReports, upload, mode } = useStore();
  const navigate = useNavigate();
  const today = todayISO(site.config.site.timezone);
  const [file, setFile] = useState<File>();
  const [over, setOver] = useState(false);
  const [meta, setMeta] = useState<ReportMeta>({
    id: '',
    kind: 'claude',
    visibility: site.config.defaults.claudeReportVisibility,
    format: 'html',
    file: 'report.html',
    title: '',
    date: today,
    companies: [],
    nodes: [],
    tags: [],
  });
  const [summaryEn, setSummaryEn] = useState('');
  const [summaryZh, setSummaryZh] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ReportMeta>) => setMeta((m) => ({ ...m, ...patch }));
  const sellSide = meta.kind === 'sell-side';

  const accept = async (f: File) => {
    setError(undefined);
    if (f.size > MAX_BYTES) return setError('Files over 45 MB cannot be uploaded through the browser. Ask Claude to add it from a session instead.');
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    const isHtml = /\.html?$/i.test(f.name) || f.type === 'text/html';
    if (!isPdf && !isHtml) return setError('Choose an .html or .pdf file.');
    setFile(f);
    const dateInName = /(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)/.exec(f.name);
    const date = dateInName ? `${dateInName[1]}-${dateInName[2]}-${dateInName[3]}` : today;
    const baseTitle = f.name.replace(/\.(html?|pdf)$/i, '').replace(/[_-]+/g, ' ').trim();
    if (isPdf) {
      set({ format: 'pdf', file: 'report.pdf', kind: 'sell-side', visibility: 'private', date, title: hasCJK(baseTitle) ? '' : baseTitle, titleZh: hasCJK(baseTitle) ? baseTitle : undefined, languages: hasCJK(baseTitle) ? ['zh'] : ['en'] });
      return;
    }
    const text = await f.text();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? baseTitle;
    const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(text)?.[1];
    const body = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ');
    const cjk = (body.match(/[㐀-鿿]/g) ?? []).length;
    const latin = (body.match(/[A-Za-z]{3,}/g) ?? []).length;
    const languages = cjk > 200 && latin > 400 ? ['zh', 'en'] : cjk > 200 ? ['zh'] : ['en'];
    set({
      format: 'html',
      file: 'report.html',
      kind: meta.kind === 'sell-side' ? 'claude' : meta.kind,
      visibility: site.config.defaults.claudeReportVisibility,
      date,
      title: hasCJK(title) ? '' : title,
      titleZh: hasCJK(title) ? title : undefined,
      subtitle: desc && !hasCJK(desc) ? desc : undefined,
      languages,
      interactive: /<script(?![^>]*data-aim-shim)/i.test(text),
    });
  };

  const submit = async () => {
    setError(undefined);
    if (!file) return setError('Choose a file first.');
    if (!meta.title.trim()) return setError('Give the report an English title (the site is English-first).');
    let id = `${meta.date}-${slugify(meta.title, 48)}`;
    const ids = new Set(allReports.map((r) => r.id));
    for (let i = 2; ids.has(id); i++) id = `${meta.date}-${slugify(meta.title, 44)}-${i}`;
    const summary = {
      en: summaryEn.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
      zh: summaryZh.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
    };
    const out: ReportMeta = {
      ...meta,
      id,
      visibility: sellSide || meta.format === 'pdf' ? 'private' : meta.visibility,
      summary: summary.en.length || summary.zh.length ? { ...(summary.en.length ? { en: summary.en } : {}), ...(summary.zh.length ? { zh: summary.zh } : {}) } : undefined,
    };
    for (const k of Object.keys(out) as (keyof ReportMeta)[]) if (out[k] === undefined || out[k] === '') delete out[k];
    setSaving(true);
    try {
      const saved = await upload({ file, meta: out });
      onClose();
      if (saved.origin === 'vault') navigate(`/report/${encodeURIComponent(saved.id)}`);
      else navigate('/research');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (mode !== 'owner') {
    return (
      <Modal title="Add a report" dirty={false} onClose={onClose} wide={false} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <p>
          Uploading stores the file in your GitHub repositories, so it needs owner sign-in (Settings → Owner sign-in).{mode === 'demo' ? ' Demo mode cannot store files.' : ''}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add a report"
      sub="Claude HTML reports and sell-side PDFs. PDFs and anything private go to your private vault."
      dirty={!!file}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <span className="down" style={{ fontSize: 'var(--step--1)', marginRight: 'auto' }}>
              {error}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving || !file} onClick={submit}>
            {saving ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void accept(f);
          }}
        >
          {file ? (
            <span>
              <b style={{ color: 'var(--ink)' }}>{file.name}</b> · {(file.size / 1024 / 1024).toFixed(1)} MB{' '}
              <button type="button" className="linkish" onClick={() => input.current?.click()}>
                change
              </button>
            </span>
          ) : (
            <span>
              Drop an .html or .pdf file here, or{' '}
              <button type="button" className="linkish" onClick={() => input.current?.click()}>
                choose one
              </button>
              .
            </span>
          )}
          <input ref={input} type="file" accept=".html,.htm,.pdf,text/html,application/pdf" hidden onChange={(e) => e.target.files?.[0] && void accept(e.target.files[0])} />
        </div>

        <div className="editor-grid">
          <Field label="Kind">
            <Segmented
              label="Kind"
              value={meta.kind}
              onChange={(kind) => set({ kind, visibility: kind === 'sell-side' ? 'private' : meta.visibility })}
              options={[
                { value: 'claude', label: 'Claude research' },
                { value: 'sell-side', label: 'Sell-side' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Field>
          <Field label="Visibility" hint={sellSide || meta.format === 'pdf' ? 'Sell-side research and PDFs are always private (copyright).' : 'Check there is nothing personal in it before making it public.'}>
            <Segmented
              label="Visibility"
              value={sellSide || meta.format === 'pdf' ? 'private' : meta.visibility}
              onChange={(visibility) => !(sellSide || meta.format === 'pdf') && set({ visibility })}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'private', label: 'Private' },
              ]}
            />
          </Field>
          <Field label="English title" className="full" htmlFor="up-title">
            <input id="up-title" className="input" value={meta.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Chinese title (optional)" htmlFor="up-titlezh">
            <input id="up-titlezh" className="input" value={meta.titleZh ?? ''} onChange={(e) => set({ titleZh: e.target.value || undefined })} />
          </Field>
          <Field label="Date" htmlFor="up-date">
            <input id="up-date" className="input" type="date" value={meta.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Type" htmlFor="up-type">
            <select id="up-type" className="select" value={meta.reportType ?? ''} onChange={(e) => set({ reportType: e.target.value || undefined })}>
              <option value="">—</option>
              <option value="company">Company</option>
              <option value="earnings">Earnings</option>
              <option value="initiation">Initiation</option>
              <option value="industry">Industry</option>
              <option value="thematic">Thematic</option>
              <option value="weekly">Weekly</option>
              <option value="macro">Macro</option>
            </select>
          </Field>
          <Field label="Languages">
            <div className="row">
              {(['en', 'zh'] as const).map((l) => (
                <label key={l} className="checkbox">
                  <input
                    type="checkbox"
                    checked={meta.languages?.includes(l) ?? false}
                    onChange={(e) => set({ languages: e.target.checked ? [...new Set([...(meta.languages ?? []), l])] : (meta.languages ?? []).filter((x) => x !== l) })}
                  />
                  {l === 'en' ? 'English' : 'Chinese'}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Companies" htmlFor="up-co">
            <CompanyMulti id="up-co" value={meta.companies} onChange={(companies) => set({ companies })} />
          </Field>
          <Field label="Industries" htmlFor="up-nodes">
            <NodeMulti id="up-nodes" value={meta.nodes} onChange={(nodes) => set({ nodes })} />
          </Field>
          <Field label="Key points in English (one per line)" className="full" htmlFor="up-sum" hint="Shown above the reader and on cards. Leave empty and ask Claude to write them later.">
            <textarea id="up-sum" className="textarea" value={summaryEn} onChange={(e) => setSummaryEn(e.target.value)} />
          </Field>
          <Field label="Key points in Chinese (optional)" className="full" htmlFor="up-sumzh">
            <textarea id="up-sumzh" className="textarea" style={{ minHeight: 60 }} value={summaryZh} onChange={(e) => setSummaryZh(e.target.value)} />
          </Field>
          {sellSide ? (
            <>
              <Field label="Broker" htmlFor="up-broker">
                <input id="up-broker" className="input" value={meta.broker ?? ''} onChange={(e) => set({ broker: e.target.value || undefined })} placeholder="e.g. HSBC" />
              </Field>
              <Field label="Analysts" htmlFor="up-analysts">
                <input id="up-analysts" className="input" value={meta.analysts?.join(', ') ?? ''} onChange={(e) => set({ analysts: e.target.value ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : undefined })} />
              </Field>
              <Field label="Rating" htmlFor="up-rating">
                <input id="up-rating" className="input" value={meta.rating ?? ''} onChange={(e) => set({ rating: e.target.value || undefined })} placeholder="Buy / Hold / Sell" />
              </Field>
              <Field label="Target price" htmlFor="up-tp">
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input id="up-tp" className="input num" inputMode="decimal" value={meta.targetPrice?.value ?? ''} onChange={(e) => { const v = numOrUndef(e.target.value); set({ targetPrice: v === undefined ? undefined : { value: v, currency: meta.targetPrice?.currency ?? 'USD' } }); }} />
                  <input className="input" style={{ maxWidth: 80 }} aria-label="Currency" value={meta.targetPrice?.currency ?? 'USD'} onChange={(e) => meta.targetPrice && set({ targetPrice: { ...meta.targetPrice, currency: e.target.value.toUpperCase() } })} />
                </div>
              </Field>
              <Field label="Price at the report" htmlFor="up-pat">
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input id="up-pat" className="input num" inputMode="decimal" value={meta.priceAtReport?.value ?? ''} onChange={(e) => { const v = numOrUndef(e.target.value); set({ priceAtReport: v === undefined ? undefined : { value: v, currency: meta.priceAtReport?.currency ?? meta.targetPrice?.currency ?? 'USD', date: meta.date } }); }} />
                  <input className="input" style={{ maxWidth: 80 }} aria-label="Currency" value={meta.priceAtReport?.currency ?? meta.targetPrice?.currency ?? 'USD'} onChange={(e) => meta.priceAtReport && set({ priceAtReport: { ...meta.priceAtReport, currency: e.target.value.toUpperCase() } })} />
                </div>
              </Field>
            </>
          ) : (
            <Field label="One-line stance (optional)" className="full" htmlFor="up-stance">
              <input id="up-stance" className="input" value={meta.stance ?? ''} onChange={(e) => set({ stance: e.target.value || undefined })} />
            </Field>
          )}
          <Field label="Tags" className="full" htmlFor="up-tags">
            <TagInput id="up-tags" value={meta.tags} onChange={(tags) => set({ tags })} />
          </Field>
          <label className="checkbox full">
            <input type="checkbox" checked={!!meta.pinned} onChange={(e) => set({ pinned: e.target.checked || undefined })} /> Pin to the top of its lists
          </label>
        </div>
        <p className="faint" style={{ fontSize: 'var(--step--2)' }}>
          {toastHint(meta)}
        </p>
      </div>
    </Modal>
  );
}

function toastHint(m: ReportMeta): string {
  return m.format === 'pdf' || m.kind === 'sell-side' || m.visibility === 'private'
    ? 'Goes to your private vault; only you can open it after signing in.'
    : 'Goes to the public repository; it appears in the library after the next site build (about two minutes).';
}

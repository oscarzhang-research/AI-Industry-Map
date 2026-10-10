import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Segmented } from '../components/ui.tsx';
import { DeleteButton, Modal } from './Modal.tsx';
import { RichText } from './RichText.tsx';
import { addDays, CompanyPicker, Field, ListEditor, NodeSelect, numOrUndef, Section, shortId, TagInput } from './fields.tsx';
import { useSeries } from '../lib/hooks.ts';
import { indexOnOrBefore, scenarioStats, splitFactorSince } from '../lib/finance.ts';
import { HIDEABLE_THESIS_FIELDS, materialChange, newRecordId } from '../lib/records.ts';
import { thesisBenchmark, thesisSymbol } from '../lib/views.ts';
import { fmtDate, fmtPct, fmtPrice, plural, todayISO } from '../lib/format.ts';
import { prune, uniqueId } from './util.ts';
import type { Catalyst, Direction, PriceSeries, Related, Risk, Scenario, Signal, SiteData, Subject, ThesisRecord, ThesisStatus, TrackingUpdate, QuotesFile } from '../lib/types.ts';

const STATUSES: { value: ThesisStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'target-hit', label: 'Target hit' },
  { value: 'stopped', label: 'Stopped out' },
  { value: 'invalidated', label: 'Invalidated (thesis broke)' },
  { value: 'expired', label: 'Expired (horizon ended)' },
  { value: 'closed', label: 'Closed early' },
  { value: 'withdrawn', label: 'Withdrawn' },
];
const RELATIONS = ['beneficiary', 'loser', 'hedge', 'peer', 'supplier', 'customer'];
const SHOW_LABEL: Record<string, string> = { target: 'target price', stop: 'stop', scenarios: 'scenarios', plan: 'trading plan', position: 'position' };

export default function ThesisEditor({ id, preset, onClose }: { id?: string; preset?: Record<string, unknown>; onClose: () => void }) {
  const { site, allRecords, allReports, quotes, saveRecord, deleteRecord, toast } = useStore();
  const navigate = useNavigate();
  const today = todayISO(site.config.site.timezone);
  const existing = id ? (allRecords.find((r) => r.id === id && r.type === 'thesis') as ThesisRecord | undefined) : undefined;
  const [form, setForm] = useState<ThesisRecord>(() => (existing ? structuredClone(existing) : initialThesis(preset, site, quotes, today)));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [reportFilter, setReportFilter] = useState('');
  const initial = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== initial.current;
  const set = (patch: Partial<ThesisRecord>) => setForm((f) => ({ ...f, ...patch }));
  const setSubject = (patch: Partial<Subject>) => setForm((f) => ({ ...f, subject: { ...f.subject, ...patch } }));

  const sym = thesisSymbol(form, site);
  const q = sym ? quotes.quotes[sym] : undefined;
  const { series } = useSeries(sym);
  const company = form.subject.company ? site.companies[form.subject.company] : undefined;
  const ccy = q?.ccy ?? company?.tickers.find((t) => t.symbol === sym)?.currency ?? (sym ? 'USD' : undefined);
  const listings = company?.tickers.filter((t) => quotes.quotes[t.symbol]) ?? [];
  const createdDay = form.createdAt.slice(0, 10);
  const closeAtCreation = series ? nominalClose(series, createdDay) : undefined;
  const changes = existing ? materialChange(existing, form) : [];
  const proxies = useMemo(() => {
    const coSyms = new Set(Object.values(site.companies).map((c) => c.symbol));
    const benchSyms = new Set(site.benchmarks.map((b) => b.symbol));
    return Object.keys(quotes.quotes).filter((s) => !coSyms.has(s) && !benchSyms.has(s)).sort();
  }, [site, quotes]);
  const autoBench = site.benchmarks.find((b) => b.symbol === thesisBenchmark({ ...form, benchmark: undefined }, site));

  const base = form.basePrice?.price;
  const sign = form.direction === 'short' ? -1 : 1;
  const up = base && form.target?.price ? sign * (form.target.price / base - 1) : undefined;
  const down = base && form.stop?.price ? sign * (form.stop.price / base - 1) : undefined;
  const sc = scenarioStats(form.scenarios, base, form.direction);

  const reportOptions = useMemo(() => {
    const needle = reportFilter.trim().toLowerCase();
    const related = (r: (typeof allReports)[number]) => (form.subject.company && r.companies.includes(form.subject.company)) || (form.subject.node && r.nodes.some((n) => n.startsWith(form.subject.node!)));
    return allReports
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.titleZh?.includes(reportFilter.trim()))
      .sort((a, b) => Number(!!related(b)) - Number(!!related(a)) || (a.date < b.date ? 1 : -1))
      .slice(0, 40);
  }, [allReports, reportFilter, form.subject]);

  const save = async () => {
    setError(undefined);
    const s = form.subject;
    if (s.kind === 'company' && !s.company) return setError('Pick the company this view is about.');
    if (s.kind === 'node' && !s.node) return setError('Pick the industry or layer this view is about.');
    if (s.kind === 'theme' && !s.theme) return setError('Pick the theme this view is about.');
    if (!form.summary?.trim()) return setError('Write the one-line conclusion.');
    if (changes.length && !reason.trim()) return setError(`You changed the ${changes.join(', ')}. Add a short reason so the revision history explains it.`);
    let rec = { ...form } as ThesisRecord;
    if (!existing) {
      const hint = s.kind === 'company' ? (company?.symbol ?? s.company) : s.kind === 'node' ? s.node?.split('/').pop() : s.theme;
      rec.id = uniqueId(newRecordId('thesis', `${hint ?? form.summary} ${form.direction}`, new Date(rec.createdAt)), allRecords);
      if (!rec.refClose && sym) {
        const ref = rec.backfilled ? closeAtCreation : q ? { price: q.c, date: q.d } : undefined;
        if (ref) rec.refClose = { price: ref.price, currency: ccy, date: ref.date };
      }
      rec.versions = [
        { at: rec.createdAt, direction: rec.direction, conviction: rec.conviction, target: rec.target?.price, stop: rec.stop?.price, horizonMonths: rec.horizonMonths, reason: rec.backfilled ? 'Opened (written down later)' : 'Opened' },
      ];
    } else if (changes.length) {
      rec.versions = [
        ...(existing.versions ?? []),
        { at: new Date().toISOString(), direction: rec.direction, conviction: rec.conviction, target: rec.target?.price, stop: rec.stop?.price, horizonMonths: rec.horizonMonths, reason: reason.trim() },
      ];
    }
    if (rec.status === 'active') delete rec.closed;
    rec = prune(rec) as ThesisRecord;
    setSaving(true);
    try {
      await saveRecord(rec, existing);
      onClose();
      if (!existing) navigate(`/thesis/${rec.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await deleteRecord(existing);
      onClose();
      navigate('/views');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal
      title={existing ? 'Edit view' : 'New view'}
      sub={existing ? `Opened ${fmtDate(existing.createdAt)} · ${existing.visibility === 'public' ? 'public' : 'private'}` : 'Structured fields up top; everything below is optional. Chinese is fine; it is translated for the public site.'}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          {existing ? <DeleteButton onDelete={remove} label="Delete view" /> : null}
          {error ? (
            <span className="down" style={{ fontSize: 'var(--step--1)', marginRight: 'auto' }}>
              {error}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Save view'}
          </button>
        </>
      }
    >
      <Section title="The call" open>
        <div className="editor-grid">
          <Field label="About" className="full">
            <Segmented
              label="Subject kind"
              value={form.subject.kind}
              onChange={(k) => set({ subject: { kind: k } })}
              options={[
                { value: 'company', label: 'A company' },
                { value: 'node', label: 'An industry or layer' },
                { value: 'theme', label: 'A theme' },
              ]}
            />
          </Field>
          {form.subject.kind === 'company' ? (
            <>
              <Field label="Company" htmlFor="th-company">
                <CompanyPicker
                  id="th-company"
                  value={form.subject.company}
                  onChange={(cid) => {
                    const c = cid ? site.companies[cid] : undefined;
                    const qq = c?.symbol ? quotes.quotes[c.symbol] : undefined;
                    setForm((f) => ({ ...f, subject: { kind: 'company', company: cid }, basePrice: !existing && qq ? { price: qq.c, currency: qq.ccy, date: qq.d } : f.basePrice }));
                  }}
                />
              </Field>
              {listings.length > 1 ? (
                <Field label="Track this listing" htmlFor="th-listing">
                  <select id="th-listing" className="select" value={sym ?? ''} onChange={(e) => setSubject({ symbol: e.target.value === company?.symbol ? undefined : e.target.value })}>
                    {listings.map((t) => (
                      <option key={t.symbol} value={t.symbol}>
                        {t.symbol}
                        {t.exchange ? ` · ${t.exchange}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <span />
              )}
            </>
          ) : form.subject.kind === 'node' ? (
            <>
              <Field label="Industry or layer" htmlFor="th-node">
                <NodeSelect id="th-node" value={form.subject.node} onChange={(p) => setSubject({ node: p })} emptyLabel="Choose…" />
              </Field>
              <Field label="Track with" htmlFor="th-proxy" hint="Default: an equal-weight basket of its listed companies.">
                <select id="th-proxy" className="select" value={form.subject.proxy ?? ''} onChange={(e) => setSubject({ proxy: e.target.value || undefined })}>
                  <option value="">Equal-weight basket</option>
                  {proxies.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Theme" htmlFor="th-theme">
                <select id="th-theme" className="select" value={form.subject.theme ?? ''} onChange={(e) => setSubject({ theme: e.target.value || undefined })}>
                  <option value="">Choose…</option>
                  {site.themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Track with" htmlFor="th-proxy2" hint="Default: an equal-weight basket of the theme's companies.">
                <select id="th-proxy2" className="select" value={form.subject.proxy ?? ''} onChange={(e) => setSubject({ proxy: e.target.value || undefined })}>
                  <option value="">Equal-weight basket</option>
                  {proxies.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Direction">
            <Segmented
              label="Direction"
              value={form.direction}
              onChange={(d: Direction) => set({ direction: d })}
              options={[
                { value: 'long', label: '▲ Long' },
                { value: 'short', label: '▼ Short' },
                { value: 'watch', label: 'Watching' },
                { value: 'neutral', label: 'Neutral' },
              ]}
            />
          </Field>
          <Field label="Conviction" hint="1 = small hunch, 5 = highest conviction">
            <Segmented
              label="Conviction"
              value={String(form.conviction ?? 3)}
              onChange={(v) => set({ conviction: Number(v) })}
              options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label="One-line conclusion" className="full" htmlFor="th-summary" hint="The sentence a reader should remember. Shown on cards and the map.">
            <textarea id="th-summary" className="textarea" style={{ minHeight: 56 }} value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="e.g. HBM pricing power lasts through 2027; the market still prices Micron as a commodity cycle." />
          </Field>
          <Field label="Title (optional)" className="full" htmlFor="th-title">
            <input id="th-title" className="input" value={form.title ?? ''} onChange={(e) => set({ title: e.target.value || undefined })} />
          </Field>
          <Field label="Tags" className="full" htmlFor="th-tags">
            <TagInput id="th-tags" value={form.tags ?? []} onChange={(tags) => set({ tags })} />
          </Field>
        </div>
      </Section>

      <Section title="Prices and horizon" sub="you set the base price; it is checked against every close" open>
        <div className="editor-grid">
          <Field label={`Base price${ccy ? ` (${ccy})` : ''}`} htmlFor="th-base">
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input
                id="th-base"
                className="input num"
                inputMode="decimal"
                value={form.basePrice?.price ?? ''}
                onChange={(e) => {
                  const price = numOrUndef(e.target.value);
                  set({ basePrice: price === undefined ? undefined : { ...form.basePrice, price, currency: ccy } });
                }}
                placeholder={sym ? '' : 'basket views need none'}
              />
              <input
                className="input"
                type="date"
                aria-label="Base price date"
                value={form.basePrice?.date?.slice(0, 10) ?? ''}
                onChange={(e) => set({ basePrice: form.basePrice ? { ...form.basePrice, date: e.target.value || undefined } : undefined })}
                style={{ maxWidth: 160 }}
              />
            </div>
            <span className="price-hint">
              {q ? (
                <span>
                  Latest close <b>{fmtPrice(q.c, q.ccy)}</b> on {fmtDate(q.d)}{' '}
                  <button type="button" className="linkish" onClick={() => set({ basePrice: { price: q.c, currency: q.ccy, date: q.d } })}>
                    use it
                  </button>
                </span>
              ) : null}
              {form.backfilled && closeAtCreation ? (
                <span>
                  Close on {fmtDate(closeAtCreation.date)} <b>{fmtPrice(closeAtCreation.price, ccy)}</b>{' '}
                  <button type="button" className="linkish" onClick={() => set({ basePrice: { price: closeAtCreation.price, currency: ccy, date: closeAtCreation.date } })}>
                    use it
                  </button>
                </span>
              ) : null}
            </span>
          </Field>
          <Field label="Horizon" htmlFor="th-horizon" hint="Months, or an end date (the date wins if both are set).">
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input id="th-horizon" className="input num" inputMode="numeric" style={{ maxWidth: 90 }} value={form.horizonMonths ?? ''} onChange={(e) => set({ horizonMonths: numOrUndef(e.target.value) })} />
              <span className="muted">months, or until</span>
              <input className="input" type="date" aria-label="Horizon end date" value={form.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || undefined })} style={{ maxWidth: 160 }} />
            </div>
          </Field>
          <Field label={`Target price${ccy ? ` (${ccy})` : ''}`} htmlFor="th-target">
            <input id="th-target" className="input num" inputMode="decimal" value={form.target?.price ?? ''} onChange={(e) => set({ target: { ...form.target, price: numOrUndef(e.target.value) as number } })} />
            <input className="input" style={{ marginTop: 6 }} placeholder="How you got it (e.g. 12× 2027E EPS of $95)" value={form.target?.method ?? ''} onChange={(e) => set({ target: { ...form.target, price: form.target?.price as number, method: e.target.value || undefined } })} aria-label="Target method" />
          </Field>
          <Field label={`Stop${ccy ? ` (${ccy})` : ''}`} htmlFor="th-stop" hint="A price that tells you the view is wrong. Optional.">
            <input id="th-stop" className="input num" inputMode="decimal" value={form.stop?.price ?? ''} onChange={(e) => set({ stop: { ...form.stop, price: numOrUndef(e.target.value) as number } })} />
            <input className="input" style={{ marginTop: 6 }} placeholder="Why this level" value={form.stop?.note ?? ''} onChange={(e) => set({ stop: { ...form.stop, price: form.stop?.price as number, note: e.target.value || undefined } })} aria-label="Stop note" />
          </Field>
          <div className="full price-hint" aria-live="polite">
            {up !== undefined ? (
              <span>
                To target <b>{fmtPct(up)}</b>
              </span>
            ) : null}
            {down !== undefined ? (
              <span>
                To stop <b>{fmtPct(down)}</b>
              </span>
            ) : null}
            {up !== undefined && down !== undefined && down < 0 ? (
              <span>
                Reward / risk <b>{(up / Math.abs(down)).toFixed(1)}×</b>
              </span>
            ) : null}
            {sc.expected !== undefined ? (
              <span>
                Scenario-weighted <b>{fmtPct(sc.expected)}</b>
              </span>
            ) : null}
          </div>
          <Field label="Scenarios" className="full" hint="Bull, base and bear prices with probabilities; the site computes the weighted return.">
            <ListEditor<Scenario>
              items={form.scenarios ?? []}
              onChange={(scenarios) => set({ scenarios })}
              cols="110px 120px 90px minmax(0,1fr) auto"
              addLabel="Scenario"
              make={() => ({ name: ['bull', 'base', 'bear'][(form.scenarios ?? []).length] ?? 'other', price: 0 })}
              render={(s, upd) => (
                <>
                  <input className="input" value={s.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Scenario name" />
                  <input className="input num" inputMode="decimal" value={s.price || ''} placeholder="Price" onChange={(e) => upd({ price: numOrUndef(e.target.value) ?? 0 })} aria-label="Scenario price" />
                  <input className="input num" inputMode="numeric" value={s.prob !== undefined ? Math.round(s.prob * 100) : ''} placeholder="%" onChange={(e) => upd({ prob: numOrUndef(e.target.value) !== undefined ? numOrUndef(e.target.value)! / 100 : undefined })} aria-label="Probability percent" />
                  <input className="input" value={s.note ?? ''} placeholder="What has to happen" onChange={(e) => upd({ note: e.target.value || undefined })} aria-label="Scenario note" />
                </>
              )}
            />
          </Field>
          <Field label="Next review" htmlFor="th-review" hint="The inbox reminds you on this date.">
            <input id="th-review" className="input" type="date" value={form.reviewOn ?? ''} onChange={(e) => set({ reviewOn: e.target.value || undefined })} />
          </Field>
          <Field label="Benchmark" htmlFor="th-bench">
            <select id="th-bench" className="select" value={form.benchmark ?? ''} onChange={(e) => set({ benchmark: e.target.value || undefined })}>
              <option value="">Automatic{autoBench ? ` (${autoBench.name})` : ''}</option>
              {site.benchmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="The case" sub="core logic, where you differ, bear case, valuation" open>
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <Field label="Core logic and the latest industry picture">
            <RichText value={form.logic} onChange={(logic) => set({ logic })} placeholder="Why this is right: the drivers, the numbers, the evidence so far." minHeight={140} />
          </Field>
          <Field label="Variant perception" hint="What do you see that consensus does not?">
            <RichText value={form.variant} onChange={(variant) => set({ variant })} placeholder="The market thinks…; I think… because…" />
          </Field>
          <Field label="What consensus believes" htmlFor="th-consensus">
            <textarea id="th-consensus" className="textarea" style={{ minHeight: 60 }} value={form.consensus ?? ''} onChange={(e) => set({ consensus: e.target.value || undefined })} />
          </Field>
          <Field label="Bear case" hint="The strongest argument against you, stated fairly.">
            <RichText value={form.bearCase} onChange={(bearCase) => set({ bearCase })} />
          </Field>
          <Field label="Valuation">
            <RichText value={form.valuation} onChange={(valuation) => set({ valuation })} placeholder="Multiples, earnings power, what the price implies." />
          </Field>
        </div>
      </Section>

      <Section title="Signals, risks and catalysts" sub={`${plural(form.signals?.length ?? 0, 'signal')} · ${plural(form.risks?.length ?? 0, 'risk')} · ${plural(form.catalysts?.length ?? 0, 'catalyst')}`}>
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          <Field label="Validation signals" hint="Data that should show up if you are right, with a date to check by.">
            <ListEditor<Signal>
              items={form.signals ?? []}
              onChange={(signals) => set({ signals })}
              cols="minmax(0,1fr) 150px 130px auto"
              addLabel="Signal"
              make={() => ({ id: shortId(), text: '', status: 'pending' })}
              render={(s, upd) => (
                <>
                  <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                    <input className="input" value={s.text} placeholder="e.g. HBM4 contract prices up again in the Q1 negotiation" onChange={(e) => upd({ text: e.target.value })} aria-label="Signal" />
                    <input className="input" value={s.note ?? ''} placeholder="Note (optional)" onChange={(e) => upd({ note: e.target.value || undefined })} aria-label="Signal note" />
                  </div>
                  <input className="input" type="date" value={s.due ?? ''} onChange={(e) => upd({ due: e.target.value || undefined })} aria-label="Check by" />
                  <select className="select" value={s.status} onChange={(e) => upd({ status: e.target.value as Signal['status'], updatedAt: today })} aria-label="Signal status">
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="partial">Partly</option>
                    <option value="falsified">Falsified</option>
                  </select>
                </>
              )}
            />
          </Field>
          <Field label="Risks and falsification" hint="What would prove you wrong, and the trigger that says so.">
            <ListEditor<Risk>
              items={form.risks ?? []}
              onChange={(risks) => set({ risks })}
              cols="minmax(0,1fr) 130px auto"
              addLabel="Risk"
              make={() => ({ id: shortId(), text: '', status: 'watching' })}
              render={(r, upd) => (
                <>
                  <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                    <input className="input" value={r.text} placeholder="The risk" onChange={(e) => upd({ text: e.target.value })} aria-label="Risk" />
                    <input className="input" value={r.trigger ?? ''} placeholder="Falsified if… (a measurable trigger)" onChange={(e) => upd({ trigger: e.target.value || undefined })} aria-label="Falsification trigger" />
                  </div>
                  <select className="select" value={r.status} onChange={(e) => upd({ status: e.target.value as Risk['status'] })} aria-label="Risk status">
                    <option value="watching">Watching</option>
                    <option value="triggered">Triggered</option>
                    <option value="cleared">Cleared</option>
                  </select>
                </>
              )}
            />
          </Field>
          <Field label="Catalysts" hint="Dated events appear on the calendar.">
            <ListEditor<Catalyst>
              items={form.catalysts ?? []}
              onChange={(catalysts) => set({ catalysts })}
              cols="minmax(0,1fr) 150px 130px auto"
              addLabel="Catalyst"
              make={() => ({ id: shortId(), label: '', status: 'upcoming' })}
              render={(c, upd) => (
                <>
                  <input className="input" value={c.label} placeholder="e.g. FQ1 results and HBM4 share" onChange={(e) => upd({ label: e.target.value })} aria-label="Catalyst" />
                  <input className="input" type="date" value={c.date ?? ''} onChange={(e) => upd({ date: e.target.value || undefined })} aria-label="Catalyst date" />
                  <select className="select" value={c.status ?? 'upcoming'} onChange={(e) => upd({ status: e.target.value as Catalyst['status'] })} aria-label="Catalyst status">
                    <option value="upcoming">Upcoming</option>
                    <option value="happened">Happened</option>
                    <option value="missed">Missed</option>
                  </select>
                </>
              )}
            />
          </Field>
        </div>
      </Section>

      <Section title="Tracking and links" sub={`${plural(form.updates?.length ?? 0, 'update')} · ${form.related?.length ?? 0} related · ${plural(form.reports?.length ?? 0, 'report')}`}>
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          <Field label="Industry updates" hint="Dated notes on what changed. You can also add these from the view's page.">
            <ListEditor<TrackingUpdate>
              items={form.updates ?? []}
              onChange={(updates) => set({ updates })}
              cols="150px minmax(0,1fr) auto"
              addLabel="Update"
              make={() => ({ date: today, text: '' })}
              render={(u, upd) => (
                <>
                  <input className="input" type="date" value={u.date} onChange={(e) => upd({ date: e.target.value })} aria-label="Update date" />
                  <textarea className="textarea" style={{ minHeight: 40 }} value={u.text} onChange={(e) => upd({ text: e.target.value })} aria-label="Update text" />
                </>
              )}
            />
          </Field>
          <Field label="Related tickers" hint="Who else wins or loses if you are right.">
            <ListEditor<Related>
              items={form.related ?? []}
              onChange={(related) => set({ related })}
              cols="minmax(0,1.2fr) 140px minmax(0,1fr) auto"
              addLabel="Related company"
              make={() => ({ company: '', relation: 'beneficiary' })}
              render={(r, upd) => (
                <>
                  <CompanyPicker value={r.company || undefined} onChange={(cid) => upd({ company: cid ?? '' })} />
                  <select className="select" value={r.relation} onChange={(e) => upd({ relation: e.target.value })} aria-label="Relation">
                    {RELATIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                  <input className="input" value={r.note ?? ''} placeholder="Why" onChange={(e) => upd({ note: e.target.value || undefined })} aria-label="Relation note" />
                </>
              )}
            />
          </Field>
          <Field label="Research behind this view" htmlFor="th-reports-filter">
            <input id="th-reports-filter" className="input" placeholder="Filter reports" value={reportFilter} onChange={(e) => setReportFilter(e.target.value)} />
            <div className="picklist" style={{ marginTop: 6 }}>
              {reportOptions.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={form.reports?.includes(r.id) ?? false}
                    onChange={(e) => set({ reports: e.target.checked ? [...(form.reports ?? []), r.id] : (form.reports ?? []).filter((x) => x !== r.id) })}
                  />
                  <span className="min0">
                    {r.title} <span className="faint">· {fmtDate(r.date)}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Plan and position" sub="hidden on the public site unless you show them">
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <Field label="Trading plan" hint="Entry, sizing, adds and trims, what makes you exit.">
            <RichText value={form.plan} onChange={(plan) => set({ plan })} />
          </Field>
          <Field label="Position" htmlFor="th-position" hint="Optional; for your own records.">
            <textarea id="th-position" className="textarea" style={{ minHeight: 50 }} value={form.position ?? ''} onChange={(e) => set({ position: e.target.value || undefined })} />
          </Field>
        </div>
      </Section>

      <Section title="Free-form notes" sub={form.body ? 'has notes' : 'anything that does not fit above'}>
        <RichText value={form.body} onChange={(body) => set({ body: body || undefined })} minHeight={160} />
      </Section>

      <Section title="Status and review" sub={form.status === 'active' ? 'active' : form.status} open={!!existing && (form.status !== 'active' || !!form.review)}>
        <div className="editor-grid">
          <Field label="Status" htmlFor="th-status">
            <select
              id="th-status"
              className="select"
              value={form.status}
              onChange={(e) => {
                const status = e.target.value as ThesisStatus;
                set({ status, closed: status === 'active' ? undefined : (form.closed ?? { date: today, price: q?.c }) });
              }}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          {form.status !== 'active' ? (
            <>
              <Field label="Closed on" htmlFor="th-closed-date">
                <input id="th-closed-date" className="input" type="date" value={form.closed?.date?.slice(0, 10) ?? today} onChange={(e) => set({ closed: { ...form.closed, date: e.target.value } })} />
              </Field>
              <Field label={`Price at close${ccy ? ` (${ccy})` : ''}`} htmlFor="th-closed-price">
                <input id="th-closed-price" className="input num" inputMode="decimal" value={form.closed?.price ?? ''} onChange={(e) => set({ closed: { ...form.closed, date: form.closed?.date ?? today, price: numOrUndef(e.target.value) } })} />
              </Field>
              <Field label="Outcome" htmlFor="th-outcome">
                <select id="th-outcome" className="select" value={form.closed?.outcome ?? ''} onChange={(e) => set({ closed: { ...form.closed, date: form.closed?.date ?? today, outcome: (e.target.value || undefined) as 'right' | 'wrong' | 'mixed' | undefined } })}>
                  <option value="">Not judged yet</option>
                  <option value="right">Right</option>
                  <option value="wrong">Wrong</option>
                  <option value="mixed">Mixed</option>
                </select>
              </Field>
              <Field label="Why it closed" className="full" htmlFor="th-closed-reason">
                <input id="th-closed-reason" className="input" value={form.closed?.reason ?? ''} onChange={(e) => set({ closed: { ...form.closed, date: form.closed?.date ?? today, reason: e.target.value || undefined } })} />
              </Field>
            </>
          ) : null}
          <Field label="Post-mortem" className="full" hint="What you got right, what you missed, what you would do differently.">
            <RichText value={form.review} onChange={(review) => set({ review: review || undefined })} />
          </Field>
          <label className="checkbox full">
            <input type="checkbox" checked={!!form.backfilled} onChange={(e) => set({ backfilled: e.target.checked || undefined })} disabled={!!existing && !existing.backfilled} />
            Written down after the fact (backfilled): the view started on an earlier date
          </label>
          {form.backfilled && !existing ? (
            <Field label="Original date" htmlFor="th-created">
              <input
                id="th-created"
                className="input"
                type="date"
                max={today}
                value={createdDay}
                onChange={(e) => e.target.value && set({ createdAt: `${e.target.value}T16:00:00.000Z`, basePrice: undefined })}
              />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title="Visibility" sub={form.visibility === 'public' ? 'public' : 'private (only you)'} open={!existing}>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <Segmented
            label="Visibility"
            value={form.visibility}
            onChange={(v) => set({ visibility: v })}
            options={[
              { value: 'private', label: 'Private · only you' },
              { value: 'public', label: 'Public · on the site' },
            ]}
          />
          {form.visibility === 'public' ? (
            <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <span className="muted" style={{ fontSize: 'var(--step--1)' }}>
                Visitors see the call, the reasoning and the tracked return. These stay hidden unless you tick them:
              </span>
              <div className="row">
                {HIDEABLE_THESIS_FIELDS.filter((f) => site.config.defaults.publicHiddenFields.includes(f)).map((f) => (
                  <label key={f} className="checkbox">
                    <input type="checkbox" checked={!!form.publicShow?.[f]} onChange={(e) => set({ publicShow: { ...form.publicShow, [f]: e.target.checked || undefined } })} />
                    Show {SHOW_LABEL[f]}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {form.example ? (
            <label className="checkbox">
              <input type="checkbox" checked={!!form.example} onChange={(e) => set({ example: e.target.checked || undefined })} /> Example (placeholder shown in the preview)
            </label>
          ) : null}
        </div>
      </Section>

      {changes.length ? (
        <div className="note-callout" style={{ marginTop: 14 }}>
          <Field label={`You changed the ${changes.join(', ')}: why?`} htmlFor="th-reason" hint="Saved as a dated revision, so the record shows what you believed and when.">
            <input id="th-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Raised the target after HBM4 qualification at the second customer" />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

function initialThesis(preset: Record<string, unknown> | undefined, site: SiteData, quotes: QuotesFile, today: string): ThesisRecord {
  const p = preset ?? {};
  const subject = (p.subject as Subject | undefined) ?? { kind: 'company' };
  const rec: ThesisRecord = {
    id: '',
    type: 'thesis',
    visibility: site.config.defaults.newRecordVisibility,
    createdAt: new Date().toISOString(),
    subject,
    direction: 'long',
    conviction: 3,
    horizonMonths: site.config.defaults.thesisHorizonMonths,
    summary: typeof p.summary === 'string' ? p.summary : '',
    status: 'active',
    reviewOn: addDays(today, site.config.defaults.reviewEveryDays),
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
  };
  if (typeof p.title === 'string') rec.title = p.title;
  if (typeof p.body === 'string') rec.body = p.body;
  if (Array.isArray(p.reports)) rec.reports = p.reports as string[];
  const sym = thesisSymbol(rec, site);
  const q = sym ? quotes.quotes[sym] : undefined;
  if (q) rec.basePrice = { price: q.c, currency: q.ccy, date: q.d };
  return rec;
}

/** As-traded close on or before a date (split-adjusted series times the later splits). */
function nominalClose(series: PriceSeries, date: string): { price: number; date: string } | undefined {
  const i = indexOnOrBefore(series.d, date);
  if (i < 0) return undefined;
  return { price: Math.round(series.c[i] * splitFactorSince(series.splits, series.d[i]) * 100) / 100, date: series.d[i] };
}

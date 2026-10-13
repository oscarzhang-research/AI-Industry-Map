import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, CompanyChip, Conviction, Crumbs, DirectionBadge, ExampleBadge, PrivateBadge, StatusIcon } from '../components/ui.tsx';
import { PriceChart, RelativeChart } from '../components/charts.tsx';
import { ReportRow } from '../components/lists.tsx';
import { ValuationThenNow } from '../components/valuation.tsx';
import { EarningsAside } from '../components/earnings.tsx';
import { useThesisSeries } from '../lib/useThesis.ts';
import { addMonths, daysBetween, indexOnOrBefore, scenarioStats, splitFactorSince, thesisPerformance } from '../lib/finance.ts';
import { display, subjectLabel } from '../lib/views.ts';
import { hiddenFieldsFor, recordLanguage, translationState } from '../lib/records.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { industryLink } from '../lib/nodes.ts';
import { fmtDate, fmtPct, fmtPrice, relativeDays, STATUS_LABEL, todayISO } from '../lib/format.ts';
import type { Risk, Signal, ThesisRecord, ThesisStatus } from '../lib/types.ts';
import { openEditor } from '../App.tsx';

const SIGNAL_LABEL: Record<Signal['status'], string> = { pending: 'Pending', confirmed: 'Confirmed', partial: 'Partly', falsified: 'Falsified' };
const RISK_LABEL: Record<Risk['status'], string> = { watching: 'Watching', triggered: 'Triggered', cleared: 'Cleared' };
const RELATION_LABEL: Record<string, string> = {
  beneficiary: 'Also benefits',
  loser: 'Loses if right',
  hedge: 'Hedge',
  peer: 'Peer',
  supplier: 'Supplier',
  customer: 'Customer',
};

export default function ThesisPage() {
  const { id } = useParams();
  const { site, quotes, allRecords, allReports, index, canEdit, saveRecord, toast } = useStore();
  const raw = allRecords.find((r) => r.id === id && r.type === 'thesis') as ThesisRecord | undefined;
  const [orig, setOrig] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const list = useMemo(() => (raw ? [raw] : []), [raw]);
  const seriesOf = useThesisSeries(list, site);

  if (!raw) {
    return (
      <div className="page">
        <div className="wrap">
          <Crumbs items={[{ label: 'Views', to: '/views' }, { label: 'Not found' }]} />
          <h1>View not found</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            It may be private or may have been removed. <Link to="/views">See all views</Link>.
          </p>
        </div>
      </div>
    );
  }

  const t = orig ? raw : display(raw);
  const { series, bench, symbol, benchSymbol, basket } = seriesOf(raw);
  const today = todayISO(site.config.site.timezone);
  const perf = thesisPerformance(t, series, bench, today);
  const nodeName = (p: string) => index.nodes.get(p)?.name;
  const label = subjectLabel(t, site, nodeName);
  const company = t.subject?.company ? site.companies[t.subject.company] : undefined;
  const benchName = site.benchmarks.find((b) => b.symbol === benchSymbol)?.name ?? benchSymbol;
  const ccy = t.basePrice?.currency || (company?.tickers.find((x) => x.symbol === symbol)?.currency ?? (basket ? undefined : 'USD'));
  const isZh = recordLanguage(raw) === 'zh';
  const tr = translationState(raw);
  const horizonEnd = t.targetDate || (t.horizonMonths ? addMonths(t.createdAt, t.horizonMonths) : undefined);
  const reviewDue = t.status === 'active' && t.reviewOn && t.reviewOn <= today;
  const hidden = raw.visibility === 'public' ? hiddenFieldsFor(raw, site.config.defaults.publicHiddenFields) : [];
  const stats = scenarioStats(t.scenarios, perf.last ? perf.last * perf.splitFactor : undefined, t.direction);
  const cited = (t.reports ?? []).map((rid) => allReports.find((r) => r.id === rid)).filter(Boolean);
  const overlayThesis = basket && perf.base ? { ...t, basePrice: { price: perf.base } } : t;
  const subjectLink =
    t.subject?.kind === 'company' && company
      ? `/company/${company.id}`
      : t.subject?.kind === 'node' && t.subject.node
        ? industryLink(t.subject.node)
        : t.subject?.kind === 'theme'
          ? `/theme/${t.subject.theme}`
          : undefined;

  const save = async (next: ThesisRecord, msg?: string) => {
    setBusy(true);
    try {
      await saveRecord(next, raw);
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmStatus = (status: ThesisStatus, on?: string) => {
    const nominal = on && series ? closeOn(series, on) : undefined;
    const reason = status === 'target-hit' ? 'Target reached (confirmed from daily closes)' : status === 'stopped' ? 'Stop reached (confirmed from daily closes)' : 'Horizon ended';
    void save({
      ...raw,
      status,
      closed: { date: on ?? today, price: nominal, outcome: status === 'target-hit' ? 'right' : status === 'stopped' ? 'wrong' : undefined, reason },
      versions: [...(raw.versions ?? []), { at: new Date().toISOString(), direction: raw.direction, conviction: raw.conviction, target: raw.target?.price, stop: raw.stop?.price, horizonMonths: raw.horizonMonths, reason }],
    });
  };

  const addUpdate = () => {
    const text = draft.trim();
    if (!text) return;
    void save({ ...raw, updates: [...(raw.updates ?? []), { date: today, text }] }, 'Update added.');
    setDraft('');
  };

  return (
    <div className="page">
      <div className="wrap">
        <Crumbs items={[{ label: 'Views', to: '/views' }, { label: label }]} />

        <header className="page-head" style={{ alignItems: 'start' }}>
          <div className="min0">
            <div className="row" style={{ gap: 8 }}>
              <DirectionBadge direction={t.direction} />
              <Conviction value={t.conviction} />
              <span className="badge">{STATUS_LABEL[t.status]}</span>
              {t.example ? <ExampleBadge /> : null}
              {t.visibility === 'private' ? <PrivateBadge /> : null}
              {t.backfilled ? (
                <span className="badge" title="Written down after the fact; its start date is the original idea date.">
                  Backfilled
                </span>
              ) : null}
              {isZh && (tr === 'pending' || tr === 'stale') ? <span className="badge">English translation pending</span> : null}
            </div>
            <div className="eyebrow" style={{ marginTop: 14 }}>
              {subjectLink ? <Link to={subjectLink}>{label}</Link> : label}
              {symbol ? ` · ${symbol}` : basket ? ` · ${basket.weighting === 'cap' ? 'index' : 'basket'} of ${basket.members}` : ''}
            </div>
            <h1 style={{ marginTop: 6, fontSize: 'clamp(1.6rem, 3.2vw, 2.3rem)', maxWidth: '30ch' }}>{t.title || t.summary}</h1>
            {t.title && t.summary ? (
              <p className="lede" style={{ marginTop: 8, maxWidth: '70ch' }}>
                {t.summary}
              </p>
            ) : null}
            <p className="muted" style={{ marginTop: 10, fontSize: 'var(--step--1)' }}>
              Opened {fmtDate(t.createdAt)}
              {horizonEnd ? ` · horizon to ${fmtDate(horizonEnd)} (${relativeDays(horizonEnd, today)})` : ''}
              {t.updatedAt && t.updatedAt.slice(0, 10) !== t.createdAt.slice(0, 10) ? ` · updated ${fmtDate(t.updatedAt)}` : ''}
            </p>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {isZh && tr === 'translated' ? (
              <button type="button" className="btn sm" onClick={() => setOrig((v) => !v)}>
                {orig ? 'Show English' : '中文原文'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const url = window.location.href;
                navigator.clipboard?.writeText(url).then(
                  () => toast('Link copied.'),
                  () => toast(url),
                );
              }}
            >
              Copy link
            </button>
            {canEdit ? (
              <button type="button" className="btn sm primary" onClick={() => openEditor({ kind: 'thesis', id: raw.id })}>
                Edit view
              </button>
            ) : null}
          </div>
        </header>

        {canEdit && perf.suggested && !dismissed ? (
          <div className="note-callout" style={{ marginBottom: 18, borderLeftColor: perf.suggested === 'target-hit' ? 'var(--up)' : perf.suggested === 'stopped' ? 'var(--down)' : 'var(--accent)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <b>Price check · </b>
                {perf.suggested === 'target-hit'
                  ? `the close on ${fmtDate(perf.suggestedOn)} reached your target.`
                  : perf.suggested === 'stopped'
                    ? `the close on ${fmtDate(perf.suggestedOn)} crossed your stop.`
                    : `the horizon ended on ${fmtDate(perf.suggestedOn)}.`}{' '}
                Nothing changes until you confirm.
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm primary" disabled={busy} onClick={() => confirmStatus(perf.suggested!, perf.suggestedOn)}>
                  Mark {STATUS_LABEL[perf.suggested].toLowerCase()}
                </button>
                {perf.suggested === 'expired' ? (
                  <button type="button" className="btn sm" onClick={() => openEditor({ kind: 'thesis', id: raw.id })}>
                    Extend horizon
                  </button>
                ) : null}
                <button type="button" className="btn sm ghost" onClick={() => setDismissed(true)}>
                  Not now
                </button>
              </span>
            </div>
          </div>
        ) : null}
        {canEdit && reviewDue ? (
          <div className="note-callout" style={{ marginBottom: 18 }}>
            <b>Review due · </b>you planned to revisit this view on {fmtDate(t.reviewOn)}. Edit it to record what changed and set the next review date.
          </div>
        ) : null}

        <div className="kpis" aria-label="Performance">
          <Kpi label={t.status === 'active' ? 'Since open' : 'Result'} value={<Change value={perf.ret} />} sub={t.direction === 'short' ? 'short: gains when price falls' : perf.start ? `from ${fmtDate(perf.start, false)}` : undefined} />
          <Kpi label={`vs ${benchName ?? 'benchmark'}`} value={<Change value={perf.excess} />} sub={perf.benchRet !== undefined ? `index ${fmtPct(perf.benchRet)}` : undefined} />
          <Kpi label={basket ? (basket.weighting === 'cap' ? 'Index at open' : 'Basket at open') : 'Base price'} value={basket ? perf.base?.toFixed(1) ?? '—' : fmtPrice(perf.base, ccy)} sub={t.basePrice?.date ? `set ${fmtDate(t.basePrice.date, false)}` : basket ? 'index level' : 'close at open'} />
          <Kpi label={t.status === 'active' ? 'Last close' : 'At close'} value={basket ? perf.last?.toFixed(1) ?? '—' : fmtPrice(perf.last, ccy)} sub={perf.lastDate ? fmtDate(perf.lastDate, false) : undefined} />
          {perf.target ? (
            <Kpi label="Target" value={fmtPrice(perf.target, ccy)} sub={perf.upside !== undefined ? `${fmtPct(perf.upside)} to go` : undefined} />
          ) : (
            <Kpi label="Best move" value={<Change value={perf.maxFavorable} />} sub="max favorable" />
          )}
          {perf.stop ? (
            <Kpi label="Stop" value={fmtPrice(perf.stop, ccy)} sub={perf.last ? `${fmtPct((t.direction === 'short' ? -1 : 1) * (perf.stop / perf.last - 1))} away` : undefined} />
          ) : (
            <Kpi label="Worst move" value={<Change value={perf.maxAdverse} />} sub="max adverse" />
          )}
        </div>

        {perf.progress !== undefined || perf.daysTotal ? (
          <div className="grid cols-2" style={{ marginTop: 12, '--gap': '20px' } as React.CSSProperties}>
            {perf.progress !== undefined ? <Bar label="Base → target" value={perf.progress} text={`${fmtPct(perf.progress, 0)} of the way`} /> : <span />}
            {perf.daysTotal ? <Bar label="Time used" value={perf.daysElapsed / perf.daysTotal} text={`${perf.daysElapsed} of ${perf.daysTotal} days`} neutral /> : null}
          </div>
        ) : null}

        <div className="thesis-grid" style={{ marginTop: 24 }}>
          <div className="min0">
            {series ? (
              <div className="card">
                <div className="eyebrow">{basket ? (basket.weighting === 'cap' ? 'Market-cap-weighted layer index' : 'Equal-weight basket') : 'Daily close'}</div>
                <div style={{ marginTop: 6 }}>
                  <PriceChart series={series} overlays={[{ thesis: overlayThesis, showTarget: true }]} ccy={ccy} height={320} />
                </div>
                {bench && perf.start && series.d.length - Math.max(0, indexOnOrBefore(series.d, perf.start)) > 3 ? (
                  <div style={{ marginTop: 18 }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                      Since the view opened, rebased
                    </div>
                    <RelativeChart a={series} b={bench} from={perf.start} to={t.closed?.date} labelA={symbol ?? 'Basket'} labelB={benchName} height={220} />
                  </div>
                ) : null}
                <div className="chart-foot">
                  <span>Daily closes, split-adjusted{perf.splitFactor !== 1 ? ` (prices you entered are divided by ${perf.splitFactor} for later splits)` : ''}.</span>
                  {basket ? (
                    <span>
                      No single listing: tracked with {basket.weighting === 'cap' ? "the layer's market-cap-weighted index" : 'an equal-weight basket of its companies'}.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty">No price series for this view. Industry and theme views use a basket, or a proxy ETF if you set one.</div>
            )}

            <div style={{ marginTop: 28 }}>
              {t.logic ? <Block title="Core logic" md={t.logic} /> : null}
              {t.variant || t.consensus ? (
                <div className="field-block">
                  <h3>Where I differ from consensus</h3>
                  {t.variant ? <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.variant) }} /> : null}
                  {t.consensus ? (
                    <div className="note-callout" style={{ marginTop: 10 }}>
                      <b>Consensus · </b>
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(t.consensus) }} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="field-block">
                <h3>Industry updates and tracking</h3>
                {t.updates?.length ? (
                  <ol className="timeline">
                    {[...t.updates]
                      .map((u, i) => ({ ...u, i }))
                      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.i - a.i))
                      .map((u) => (
                        <li key={`${u.date}-${u.i}`}>
                          <time>{fmtDate(u.date)}</time>
                          <div className="prose" style={{ fontSize: 'var(--step--1)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(u.text) }} />
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
                    No updates yet.
                  </p>
                )}
                {canEdit ? (
                  <div className="stack" style={{ marginTop: 10, '--gap': '8px' } as React.CSSProperties}>
                    <textarea className="textarea" rows={2} placeholder="What changed? (dated today; Chinese is fine, it gets translated)" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New update" />
                    <div>
                      <button type="button" className="btn sm" disabled={busy || !draft.trim()} onClick={addUpdate}>
                        Add update
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {t.signals?.length ? (
                <div className="field-block">
                  <h3>Validation signals · what should happen if I am right</h3>
                  <ul className="checklist">
                    {t.signals.map((s) => {
                      const label = SIGNAL_LABEL[s.status] ?? 'Pending';
                      return (
                        <li key={s.id}>
                          <span className="st">
                            <StatusIcon kind={s.status ?? 'pending'} label={label} />
                          </span>
                          <span className="txt">
                            {s.text}
                            {s.note ? <span className="note">{s.note}</span> : null}
                          </span>
                          <span className="due">{s.due ? `by ${fmtDate(s.due, false)}` : label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {t.risks?.length ? (
                <div className="field-block">
                  <h3>Risks and falsification · what would prove me wrong</h3>
                  <ul className="checklist">
                    {t.risks.map((r) => {
                      const label = RISK_LABEL[r.status] ?? 'Watching';
                      return (
                        <li key={r.id}>
                          <span className="st">
                            <StatusIcon kind={r.status ?? 'watching'} label={label} />
                          </span>
                          <span className="txt">
                            {r.text}
                            {r.trigger ? <span className="note">Falsified if: {r.trigger}</span> : null}
                            {r.note ? <span className="note">{r.note}</span> : null}
                          </span>
                          <span className="due">{label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {t.bearCase ? <Block title="Bear case · the best argument against" md={t.bearCase} /> : null}

              {t.valuation || t.target?.method ? (
                <div className="field-block">
                  <h3>Valuation</h3>
                  {t.valuation ? <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.valuation) }} /> : null}
                  {t.target?.method ? (
                    <p className="muted" style={{ marginTop: 8, fontSize: 'var(--step--1)' }}>
                      Target method: {t.target.method}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {t.scenarios?.length ? (
                <div className="field-block">
                  <h3>Scenarios</h3>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th className="n">Price</th>
                          <th className="n">Probability</th>
                          <th className="n">From last close</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.scenarios.map((s, i) => {
                          const lastNominal = perf.last ? perf.last * perf.splitFactor : undefined;
                          return (
                            <tr key={i}>
                              <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{s.name}</td>
                              <td className="n">{fmtPrice(s.price, ccy)}</td>
                              <td className="n">{s.prob !== undefined ? `${Math.round(s.prob * 100)}%` : '—'}</td>
                              <td className="n">{lastNominal ? <Change value={s.price / lastNominal - 1} /> : '—'}</td>
                              <td className="muted" style={{ fontSize: 'var(--step--1)' }}>
                                {s.note}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {stats.expected !== undefined || stats.payoff !== undefined ? (
                    <p className="muted" style={{ marginTop: 8, fontSize: 'var(--step--1)' }}>
                      {stats.expected !== undefined ? <>Probability-weighted return <b className="ink2">{fmtPct(stats.expected)}</b>. </> : null}
                      {stats.payoff !== undefined ? <>Upside / downside ratio <b className="ink2">{stats.payoff.toFixed(1)}×</b>.</> : null}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {t.catalysts?.length ? (
                <div className="field-block">
                  <h3>Catalysts</h3>
                  <ul className="checklist">
                    {[...t.catalysts]
                      .sort((a, b) => ((a.date ?? '9') < (b.date ?? '9') ? -1 : 1))
                      .map((c) => (
                        <li key={c.id}>
                          <span className="st">
                            <StatusIcon kind={c.status ?? 'upcoming'} label={c.status === 'happened' ? 'Happened' : c.status === 'missed' ? 'Missed' : 'Upcoming'} />
                          </span>
                          <span className="txt">
                            {c.label}
                            {c.note ? <span className="note">{c.note}</span> : null}
                          </span>
                          <span className="due">{c.date ? fmtDate(c.date) : 'date open'}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {t.plan ? <Block title="Trading plan" md={t.plan} /> : null}
              {t.position ? <Block title="Position" md={t.position} /> : null}

              {t.related?.length ? (
                <div className="field-block">
                  <h3>Related tickers</h3>
                  <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                    {t.related.map((r, i) => {
                      const c = site.companies[r.company];
                      if (!c) return null;
                      return (
                        <div key={i} className="row" style={{ gap: 8 }}>
                          <span className="badge">{RELATION_LABEL[r.relation] ?? r.relation}</span>
                          <CompanyChip company={c} />
                          {r.note ? <span className="muted" style={{ fontSize: 'var(--step--1)' }}>{r.note}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {cited.length ? (
                <div className="field-block">
                  <h3>Research behind this view</h3>
                  <div className="card" style={{ padding: '0 14px' }}>
                    {cited.map((r) => (r ? <ReportRow key={r.id} r={r} site={site} /> : null))}
                  </div>
                </div>
              ) : null}

              {t.body ? <Block title="Notes" md={t.body} /> : null}

              {t.closed || t.review ? (
                <div className="field-block">
                  <h3>Post-mortem</h3>
                  {t.closed ? (
                    <p style={{ fontSize: 'var(--step--1)' }}>
                      Closed {fmtDate(t.closed.date)}
                      {t.closed.price ? ` at ${fmtPrice(t.closed.price, ccy)}` : ''}
                      {t.closed.outcome ? ` · outcome: ${t.closed.outcome}` : ''}
                      {t.closed.reason ? ` · ${t.closed.reason}` : ''}
                    </p>
                  ) : null}
                  {t.review ? <div className="prose" style={{ marginTop: 6 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(t.review) }} /> : null}
                </div>
              ) : null}

              {t.versions?.length ? (
                <div className="field-block">
                  <h3>Revisions</h3>
                  <ol className="timeline">
                    {[...t.versions].reverse().map((v, i) => (
                      <li key={i} className={i === 0 ? 'k' : ''}>
                        <time>{fmtDate(v.at)}</time>
                        <div style={{ fontSize: 'var(--step--1)' }}>
                          {v.reason}
                          <span className="muted">
                            {[
                              v.direction ? ` · ${v.direction}` : '',
                              v.conviction ? ` · conviction ${v.conviction}` : '',
                              v.target ? ` · target ${fmtPrice(v.target, ccy)}` : '',
                              v.stop ? ` · stop ${fmtPrice(v.stop, ccy)}` : '',
                              v.horizonMonths ? ` · ${v.horizonMonths}M` : '',
                            ].join('')}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="side-card stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            <div className="card">
              <dl className="kv">
                <dt>Subject</dt>
                <dd>{subjectLink ? <Link to={subjectLink}>{label}</Link> : label}</dd>
                <dt>Tracked by</dt>
                <dd>{symbol ?? (basket ? `${basket.weighting === 'cap' ? 'Market-cap-weighted index' : 'Equal-weight basket'} (${basket.members})` : '—')}</dd>
                <dt>Direction</dt>
                <dd>
                  <DirectionBadge direction={t.direction} />
                </dd>
                {t.conviction ? (
                  <>
                    <dt>Conviction</dt>
                    <dd>{t.conviction} of 5</dd>
                  </>
                ) : null}
                <dt>Horizon</dt>
                <dd>{t.horizonMonths ? `${t.horizonMonths} months` : horizonEnd ? `to ${fmtDate(horizonEnd)}` : 'Open-ended'}</dd>
                <dt>Opened</dt>
                <dd>{fmtDate(t.createdAt)}</dd>
                {t.refClose?.price && t.basePrice?.price && Math.abs(t.refClose.price / t.basePrice.price - 1) > 0.002 ? (
                  <>
                    <dt>Close that day</dt>
                    <dd>{fmtPrice(t.refClose.price, ccy)}</dd>
                  </>
                ) : null}
                <dt>Benchmark</dt>
                <dd>{benchName ?? '—'}</dd>
                {t.reviewOn ? (
                  <>
                    <dt>Next review</dt>
                    <dd className={reviewDue ? 'down' : ''}>
                      {fmtDate(t.reviewOn)}
                      {reviewDue ? ' · due' : ''}
                    </dd>
                  </>
                ) : null}
                {perf.daysElapsed ? (
                  <>
                    <dt>Held</dt>
                    <dd>{perf.daysElapsed} days</dd>
                  </>
                ) : null}
                <dt>Language</dt>
                <dd>{isZh ? (tr === 'translated' ? 'Chinese, translated' : 'Chinese') : 'English'}</dd>
              </dl>
              {t.tags?.length ? (
                <div className="chips" style={{ marginTop: 12 }}>
                  {t.tags.map((tag) => {
                    const theme = site.themes.find((x) => x.id === tag);
                    return theme ? (
                      <Link key={tag} className="chip" to={`/theme/${tag}`}>
                        <span className="nm">{theme.name}</span>
                      </Link>
                    ) : (
                      <span key={tag} className="chip">
                        <span className="nm">#{tag}</span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {symbol && !basket ? <ValuationThenNow series={series} quote={quotes.quotes[symbol]} from={t.createdAt} to={t.closed?.date} ccy={ccy} /> : null}
            {symbol && !basket && t.status === 'active' ? <EarningsAside symbol={symbol} quote={quotes.quotes[symbol]} /> : null}
            {canEdit && hidden.length ? (
              <div className="note-callout">
                Public, but visitors do not see: {hidden.join(', ')}. Change this under “Visibility” in the editor.
              </div>
            ) : null}
            {t.status === 'active' && horizonEnd ? (
              <p className="faint" style={{ fontSize: 'var(--step--2)' }}>
                {daysBetween(today, horizonEnd) >= 0 ? `${daysBetween(today, horizonEnd)} days left in the horizon.` : 'Past its horizon.'}
              </p>
            ) : null}
            <p className="faint" style={{ fontSize: 'var(--step--2)' }}>
              Returns are in the direction of the call and exclude dividends. {site.config.site.disclaimer}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value num" style={{ fontSize: 'var(--step-1)' }}>
        {value}
      </span>
      {sub ? (
        <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function Bar({ label, value, text, neutral = false }: { label: string; value: number; text: string; neutral?: boolean }) {
  const w = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--step--2)' }}>
        <span className="muted">{label}</span>
        <span className="num ink2">{text}</span>
      </div>
      <div className="progress" style={{ marginTop: 4 }}>
        <span style={{ width: `${w * 100}%`, background: neutral ? 'var(--ink-2)' : value < 0 ? 'var(--down)' : 'var(--up)' }} />
      </div>
    </div>
  );
}

function Block({ title, md }: { title: string; md: string }) {
  return (
    <div className="field-block">
      <h3>{title}</h3>
      <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
    </div>
  );
}

/** Nominal (as-traded) close on a date: split-adjusted series value times later splits. */
function closeOn(series: { d: string[]; c: number[]; splits?: [string, number][] }, date: string): number | undefined {
  const i = indexOnOrBefore(series.d, date);
  if (i < 0) return undefined;
  return Math.round(series.c[i] * splitFactorSince(series.splits, series.d[i]) * 100) / 100;
}

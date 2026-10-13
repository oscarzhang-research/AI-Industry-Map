// Owner only: the ratings and targets in the sell-side research held in the vault, checked against prices.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { useSeriesMany } from '../lib/hooks.ts';
import { Change, Section } from '../components/ui.tsx';
import { brokerSummary, callOutcome, callSymbol, type CallRow } from '../lib/calls.ts';
import { fmtDate, fmtPct, fmtPrice, plural, todayISO } from '../lib/format.ts';

export default function CallsPage() {
  const { site, allReports, mode, canEdit } = useStore();
  const today = todayISO(site.config.site.timezone);
  const calls = useMemo(() => allReports.filter((r) => r.kind === 'sell-side' && r.targetPrice?.value && r.companies?.length), [allReports]);
  const symbols = useMemo(() => calls.map((r) => callSymbol(r, site)), [calls, site]);
  const series = useSeriesMany(symbols);
  const rows: CallRow[] = useMemo(
    () =>
      calls
        .map((r, i) => ({ r, symbol: symbols[i], s: symbols[i] ? series.get(symbols[i]!) : undefined }))
        .map(({ r, symbol, s }) => ({ report: r, company: site.companies[r.companies[0]], symbol, ...callOutcome(r, s, today) }))
        .sort((a, b) => (a.report.date < b.report.date ? 1 : -1)),
    [calls, symbols, series, site, today],
  );
  const brokers = useMemo(() => brokerSummary(rows), [rows]);
  const others = allReports.filter((r) => r.kind === 'sell-side' && !(r.targetPrice?.value && r.companies?.length)).length;

  if (!canEdit) {
    return (
      <div className="page">
        <div className="wrap">
          <h1>Sell-side calls</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            This page is for the site owner. Broker research stays in the private vault. <Link to="/settings">Sign in</Link> to see it.
          </p>
        </div>
      </div>
    );
  }

  const reached = rows.filter((x) => x.reachedOn).length;
  const open = rows.filter((x) => x.status === 'open').length;
  const sinceMedian = median(rows.map((x) => x.since).filter((v): v is number => v !== undefined));
  return (
    <div className="page">
      <div className="wrap">
        <div className="eyebrow">Private · sell-side calls{mode === 'demo' ? ' · demo' : ''}</div>
        <h1 style={{ marginTop: 4 }}>How the brokers' calls are doing</h1>
        <p className="lede" style={{ marginTop: 8, maxWidth: '72ch' }}>
          Every rating and target price in the broker research in your vault, checked against daily closes. Only you see this page; the research and its figures never
          leave the vault.
        </p>

        <div className="kpis" style={{ marginTop: 20 }}>
          <Stat label="Calls with a target" value={String(rows.length)} />
          <Stat label="Target reached" value={`${reached}`} sub={rows.length ? `${Math.round((reached / rows.length) * 100)}% of calls` : undefined} />
          <Stat label="Still open" value={String(open)} sub="within 12 months, target not reached" />
          <Stat label="Median since report" value={<Change value={sinceMedian} />} sub="share price, from the price in the report" />
        </div>

        <Section title="Calls" sub="Newest first. Prices and targets are adjusted for later stock splits. A target counts as reached on the first close at or beyond it within 12 months.">
          {rows.length ? (
            <div className="table-wrap card" style={{ padding: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Broker</th>
                    <th>Company</th>
                    <th>Rating</th>
                    <th className="n">Price then</th>
                    <th className="n">Target</th>
                    <th className="n">Last close</th>
                    <th className="n">Since report</th>
                    <th className="n">Still to go</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.report.id}>
                      <td>
                        <Link to={`/report/${encodeURIComponent(x.report.id)}`}>{fmtDate(x.report.date)}</Link>
                      </td>
                      <td>{x.report.broker ?? '—'}</td>
                      <td>{x.company ? <Link to={`/company/${x.company.id}`}>{x.company.name}</Link> : x.report.companies[0]}</td>
                      <td>{x.report.rating ?? '—'}</td>
                      <td className="n">{fmtPrice(x.then, x.ccy)}</td>
                      <td className="n">{fmtPrice(x.target, x.ccy)}</td>
                      <td className="n">{fmtPrice(x.last, x.ccy)}</td>
                      <td className="n">
                        <Change value={x.since} />
                      </td>
                      <td className="n">{x.toGo !== undefined && !x.reachedOn ? fmtPct(x.toGo) : '—'}</td>
                      <td>
                        {x.reachedOn ? (
                          <span className="badge status-good">Reached {fmtDate(x.reachedOn, false)}</span>
                        ) : x.status === 'expired' ? (
                          <span className="badge">Not reached in 12 months</span>
                        ) : x.status === 'no-price' ? (
                          <span className="badge">No price series</span>
                        ) : (
                          <span className="badge">Open · {plural(x.daysLeft ?? 0, 'day')} left</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              {mode === 'owner'
                ? 'No broker research with a rating and target yet. File a sell-side PDF with its broker, rating, target price and price at report, and it shows up here.'
                : 'In demo mode there is no broker research. Signed in, the calls in your vault appear here.'}
            </div>
          )}
          {others ? (
            <p className="faint" style={{ fontSize: 'var(--step--1)', marginTop: 8 }}>
              {plural(others, 'other sell-side report')} without a single-company target (sector or weekly notes) are in the research library.
            </p>
          ) : null}
        </Section>

        {brokers.length ? (
          <Section title="By broker" sub="Calls counted once each. Hit rate: targets reached within 12 months, among calls at least 12 months old or already reached.">
            <div className="table-wrap card" style={{ padding: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Broker</th>
                    <th className="n">Calls</th>
                    <th className="n">Reached</th>
                    <th className="n">Hit rate</th>
                    <th className="n">Median since report</th>
                  </tr>
                </thead>
                <tbody>
                  {brokers.map((b) => (
                    <tr key={b.broker}>
                      <td>{b.broker}</td>
                      <td className="n">{b.calls}</td>
                      <td className="n">{b.reached}</td>
                      <td className="n">{b.hitRate !== undefined ? `${Math.round(b.hitRate * 100)}%` : '—'}</td>
                      <td className="n">
                        <Change value={b.medianSince} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
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

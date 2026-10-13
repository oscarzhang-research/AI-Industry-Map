// Earnings: the home page's week of reports, the company page's results table, and small flags for views.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { EarningsRecord, Quote } from '../lib/types.ts';
import { useStore } from '../lib/store.tsx';
import { useEarnings } from '../lib/hooks.ts';
import { earningsFlag, fmtEps, recentReports, reportTimeLabel, upcomingReports, type EarningsFlag } from '../lib/earnings.ts';
import { fmtCompact, fmtDate, fmtPct, plural, relativeDays, todayISO } from '../lib/format.ts';
import { Change, Section } from './ui.tsx';

const SOURCE_NOTE = 'Consensus and results from Yahoo Finance. The consensus is the one shown before each report.';
const MOVE_NOTE = 'Move: share price change from the last close before the report to one session after it.';

function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/** Home page: results from the last seven days and the reports due in the next seven. */
export function EarningsWeek() {
  const { site, quotes } = useStore();
  const earnings = useEarnings();
  const today = todayISO(site.config.site.timezone);
  // Between seasons the last week can be empty: then look back a month.
  const recent = useMemo(() => {
    const week = recentReports(site, quotes.quotes, earnings, shiftDays(today, -7), today);
    return week.length >= 3 ? { list: week, days: 7 } : { list: recentReports(site, quotes.quotes, earnings, shiftDays(today, -30), today), days: 30 };
  }, [site, quotes, earnings, today]);
  const upcoming = useMemo(() => upcomingReports(site, quotes.quotes, earnings, today, shiftDays(today, 7)), [site, quotes, earnings, today]);
  if (!recent.list.length && !upcoming.length) return null;
  return (
    <Section
      eyebrow="Earnings"
      title="This week's reports"
      sub={
        recent.list.length
          ? `Results from the last ${recent.days === 7 ? 'seven' : '30'} days against consensus, and reports due in the next seven. ${SOURCE_NOTE}`
          : `Reports due in the next seven days, with the consensus for each. Results appear here, against that consensus, as they come out. ${SOURCE_NOTE}`
      }
      tools={
        <Link to="/calendar" className="btn sm">
          Calendar
        </Link>
      }
    >
      <div className={`grid earn-week${recent.list.length && upcoming.length ? ' cols-2' : ''}`} style={{ '--gap': '20px' } as React.CSSProperties}>
        {recent.list.length ? <ReportedCard recent={recent} /> : null}
        {upcoming.length ? <ComingUpCard upcoming={upcoming} today={today} /> : null}
      </div>
    </Section>
  );
}

type Recent = { list: ReturnType<typeof recentReports>; days: number };

function ReportedCard({ recent }: { recent: Recent }) {
  return (
    <div className="card min0">
      <div className="eyebrow">Reported{recent.days === 30 ? ' in the last 30 days' : ''}</div>
      {recent.list.length ? (
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table className="data compact">
            <thead>
              <tr>
                <th>Company</th>
                <th className="n">EPS vs est.</th>
                <th className="n">Revenue vs est.</th>
                <th className="n">Move</th>
              </tr>
            </thead>
            <tbody>
              {recent.list.slice(0, 10).map(({ company, symbol, report: r, ccy }) => (
                <tr key={symbol}>
                  <td>
                    <Link to={`/company/${company.id}`}>{company.name}</Link>
                    <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
                      {symbol} · {fmtDate(r.date, false)}
                    </div>
                  </td>
                  <td className="n" title={r.epsActual !== undefined ? `EPS ${fmtEps(r.epsActual)} vs ${fmtEps(r.epsEst)} expected` : undefined}>
                    {r.surprise !== undefined ? <Change value={r.surprise / 100} /> : fmtEps(r.epsActual)}
                  </td>
                  <td className="n" title={r.revActual ? `Revenue ${fmtCompact(r.revActual, ccy)}${r.revEst ? ` vs ${fmtCompact(r.revEst, ccy)} expected` : ''}` : undefined}>
                    {r.revSurprise !== undefined ? <Change value={r.revSurprise} /> : r.revActual ? fmtCompact(r.revActual, ccy) : '—'}
                  </td>
                  <td className="n">
                    <Change value={r.move} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.list.length > 10 ? (
            <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 6 }}>
              and {plural(recent.list.length - 10, 'more company', 'more companies')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 8 }}>
          No results in the last month.
        </div>
      )}
      <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 8 }}>
        {MOVE_NOTE}
      </p>
    </div>
  );
}

function ComingUpCard({ upcoming, today }: { upcoming: ReturnType<typeof upcomingReports>; today: string }) {
  const shownUp = upcoming.slice(0, 14);
  const days = [...new Set(shownUp.map((u) => u.date))];
  return (
    <div className="card min0">
      <div className="eyebrow">Coming up</div>
      {days.length ? (
        <div className="earn-days" style={{ marginTop: 6 }}>
          {days.map((d) => (
            <div key={d} className="earn-day">
              <div className="when">
                {weekday(d)} {fmtDate(d, false)}
                <div className="faint">{relativeDays(d, today)}</div>
              </div>
              <ul>
                {shownUp
                  .filter((u) => u.date === d)
                  .map((u) => {
                    const time = reportTimeLabel(u.symbol, u.next?.time);
                    return (
                      <li key={u.symbol}>
                        <Link to={`/company/${u.company.id}`}>{u.company.name}</Link>
                        <span className="faint">
                          {[u.symbol, time, u.next?.epsEst !== undefined ? `EPS est. ${fmtEps(u.next.epsEst)}` : '', u.estimated ? 'date estimated' : ''].filter(Boolean).join(' · ')}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 8 }}>
          No reports due in the next week.
        </div>
      )}
      {upcoming.length > shownUp.length ? (
        <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 8 }}>
          {plural(upcoming.length - shownUp.length, 'more report')} this week on the <Link to="/calendar">calendar</Link>.
        </p>
      ) : null}
    </div>
  );
}

/** Company page: the next report and recent results against consensus. */
export function EarningsSection({ symbol, quote }: { symbol: string; quote?: Quote }) {
  const { site } = useStore();
  const earnings = useEarnings();
  const rec: EarningsRecord | undefined = earnings[symbol];
  const today = todayISO(site.config.site.timezone);
  const next = rec?.next && rec.next.date >= today ? rec.next : undefined;
  const nextDate = next?.date ?? (quote?.earn && quote.earn >= today ? quote.earn : undefined);
  const history = rec?.history.filter((h) => h.epsActual !== undefined || h.revActual !== undefined) ?? [];
  if (!nextDate && !history.length) return null;
  const ccy = rec?.ccy;
  const time = reportTimeLabel(symbol, next?.time);
  return (
    <Section eyebrow="Earnings" title="Results against consensus" sub={`${SOURCE_NOTE} ${MOVE_NOTE}`}>
      {nextDate ? (
        <div className="note-callout" style={{ marginBottom: 12 }}>
          <b>Next report · </b>
          {fmtDate(nextDate)} ({relativeDays(nextDate, today)}){time ? `, ${time}` : ''}
          {next?.estimated || (!next && quote?.earnEst) ? ', date estimated' : ''}.
          {next?.epsEst !== undefined ? ` Consensus EPS ${fmtEps(next.epsEst)}${next.epsN ? ` (${plural(next.epsN, 'analyst')})` : ''}.` : ''}
          {next?.revEst ? ` Revenue ${fmtCompact(next.revEst, ccy)}${next.revN ? ` (${plural(next.revN, 'analyst')})` : ''}.` : ''}
        </div>
      ) : null}
      {history.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Reported</th>
                <th>Quarter to</th>
                <th className="n">EPS est.</th>
                <th className="n">EPS</th>
                <th className="n">Surprise</th>
                <th className="n">Revenue est.</th>
                <th className="n">Revenue</th>
                <th className="n">Surprise</th>
                <th className="n">Move</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.date}>
                  <td>{fmtDate(h.date)}</td>
                  <td className="muted">{h.period ? fmtDate(h.period, false) : '—'}</td>
                  <td className="n">{fmtEps(h.epsEst)}</td>
                  <td className="n">{fmtEps(h.epsActual)}</td>
                  <td className="n">{h.surprise !== undefined ? <Change value={h.surprise / 100} /> : '—'}</td>
                  <td className="n">{h.revEst ? fmtCompact(h.revEst, ccy) : '—'}</td>
                  <td className="n">{h.revActual ? fmtCompact(h.revActual, ccy) : '—'}</td>
                  <td className="n">{h.revSurprise !== undefined ? <Change value={h.revSurprise} /> : '—'}</td>
                  <td className="n">
                    <Change value={h.move} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 8 }}>
        EPS is per share in the currency the company reports in{ccy ? ` (revenue in ${ccy})` : ''}. Revenue estimates are recorded from the week before each report onward, so older quarters show the result only.
      </p>
    </Section>
  );
}

/** View page aside: when the subject reports next and how the last report went. */
export function EarningsAside({ symbol, quote }: { symbol: string; quote?: Quote }) {
  const { site } = useStore();
  const earnings = useEarnings();
  const rec = earnings[symbol];
  const today = todayISO(site.config.site.timezone);
  const next = rec?.next && rec.next.date >= today ? rec.next : undefined;
  const nextDate = next?.date ?? (quote?.earn && quote.earn >= today ? quote.earn : undefined);
  const last = rec?.history.find((h) => h.epsActual !== undefined || h.revActual !== undefined);
  if (!nextDate && !last) return null;
  const time = reportTimeLabel(symbol, next?.time);
  return (
    <div className="card">
      <div className="eyebrow">Earnings</div>
      <dl className="kv" style={{ marginTop: 6 }}>
        {nextDate ? (
          <>
            <dt>Next report</dt>
            <dd>
              {fmtDate(nextDate)}
              <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
                {[relativeDays(nextDate, today), time, next?.estimated || (!next && quote?.earnEst) ? 'date estimated' : '', next?.epsEst !== undefined ? `EPS est. ${fmtEps(next.epsEst)}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </dd>
          </>
        ) : null}
        {last ? (
          <>
            <dt>Last report</dt>
            <dd>
              {fmtDate(last.date)}
              <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
                {[
                  last.surprise !== undefined ? `EPS ${fmtPct(last.surprise / 100)} vs est.` : last.epsActual !== undefined ? `EPS ${fmtEps(last.epsActual)}` : '',
                  last.revSurprise !== undefined ? `revenue ${fmtPct(last.revSurprise)} vs est.` : '',
                  last.move !== undefined ? `shares ${fmtPct(last.move)} over two sessions` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** A small badge for view cards: results just out, or a report coming up. */
export function EarningsBadge({ symbol }: { symbol: string | undefined }) {
  const { site, quotes } = useStore();
  const earnings = useEarnings();
  const today = todayISO(site.config.site.timezone);
  const flag: EarningsFlag | undefined = symbol ? earningsFlag(symbol, quotes.quotes[symbol], earnings, today) : undefined;
  if (!flag) return null;
  if (flag.kind === 'upcoming') {
    const when = flag.days === 0 ? 'today' : flag.days === 1 ? 'tomorrow' : fmtDate(flag.date, false);
    return (
      <span className="badge earn" title="Earnings report coming up">
        Reports {when}
      </span>
    );
  }
  const s = flag.report?.surprise;
  return (
    <span className="badge earn" title="Results published: worth a look against this view">
      Reported {fmtDate(flag.date, false)}
      {s !== undefined ? ` · EPS ${fmtPct(s / 100)} vs est.` : ''}
    </span>
  );
}

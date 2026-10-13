import { Link } from 'react-router-dom';
import type { PriceSeries, SiteData, ThesisRecord } from '../lib/types.ts';
import { thesisPerformance } from '../lib/finance.ts';
import { fmtDate, fmtPct, STATUS_LABEL } from '../lib/format.ts';
import { Change, Conviction, DirectionBadge, ExampleBadge, PrivateBadge } from './ui.tsx';
import { display, subjectLabel } from '../lib/views.ts';
import { translationState } from '../lib/records.ts';
import { EarningsBadge } from './earnings.tsx';

export function ViewCard({
  thesis,
  site,
  series,
  bench,
  nodeName,
}: {
  thesis: ThesisRecord;
  site: SiteData;
  series?: PriceSeries;
  bench?: PriceSeries;
  nodeName: (p: string) => string | undefined;
}) {
  const t = display(thesis);
  const perf = thesisPerformance(t, series, bench);
  const company = t.subject?.company ? site.companies[t.subject.company] : undefined;
  const showTarget = t.target?.price !== undefined;
  const tr = translationState(thesis);
  return (
    <Link to={`/thesis/${t.id}`} className="view-card">
      <div className="head">
        <DirectionBadge direction={t.direction} />
        <Conviction value={t.conviction} />
        {t.example ? <ExampleBadge /> : null}
        {t.visibility === 'private' ? <PrivateBadge /> : null}
        {tr === 'pending' || tr === 'stale' ? <span className="badge">EN pending</span> : null}
        {t.status !== 'active' ? <span className="badge">{STATUS_LABEL[t.status]}</span> : null}
        {t.status === 'active' && t.subject?.kind === 'company' ? <EarningsBadge symbol={t.subject.symbol ?? company?.symbol} /> : null}
      </div>
      <div>
        <div className="subject">
          {subjectLabel(t, site, nodeName)}
          {company?.symbol ? <span className="tk">{company.symbol}</span> : null}
        </div>
        <p className="summary" style={{ marginTop: 6 }}>
          {t.summary}
        </p>
      </div>
      <div className="metrics">
        <div className="stat">
          <span className="label">Since {fmtDate(t.createdAt, false)}</span>
          <span className="value">
            <Change value={perf.ret} />
          </span>
        </div>
        <div className="stat">
          <span className="label">vs index</span>
          <span className="value">
            <Change value={perf.excess} />
          </span>
        </div>
        <div className="stat">
          <span className="label">{showTarget ? 'To target' : 'Horizon'}</span>
          <span className="value num">
            {showTarget ? fmtPct(perf.upside) : t.horizonMonths ? `${t.horizonMonths}M` : '—'}
          </span>
        </div>
      </div>
    </Link>
  );
}

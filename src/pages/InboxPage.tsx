import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Section } from '../components/ui.tsx';
import { ReportRow } from '../components/lists.tsx';
import { useThesisSeries } from '../lib/useThesis.ts';
import { thesisPerformance } from '../lib/finance.ts';
import { recordLanguage, translationState } from '../lib/records.ts';
import { activeTheses, display, subjectLabel } from '../lib/views.ts';
import { fmtDate, plural, STATUS_LABEL, todayISO } from '../lib/format.ts';
import type { AnyRecord } from '../lib/types.ts';

export default function InboxPage() {
  const { site, allRecords, allReports, canEdit, mode, index } = useStore();
  const today = todayISO(site.config.site.timezone);
  const nodeName = (p: string) => index.nodes.get(p)?.name;
  const active = useMemo(() => activeTheses(allRecords).filter((t) => !t.example), [allRecords]);
  const seriesOf = useThesisSeries(active, site);

  const toTranslate = useMemo(
    () => allRecords.filter((r) => r.origin !== 'public' && recordLanguage(r) === 'zh' && ['pending', 'stale'].includes(translationState(r))),
    [allRecords],
  );
  const due = active
    .map((t) => {
      const { series, bench } = seriesOf(t);
      return { t, perf: thesisPerformance(t, series, bench, today) };
    })
    .filter(({ t, perf }) => perf.suggested || (t.reviewOn && t.reviewOn <= today));
  const unread = allReports.filter((r) => r.origin === 'vault' && !r.read);
  const loose = allRecords.filter((r) => r.type === 'note' && !(r.subjects ?? []).length);

  if (!canEdit) {
    return (
      <div className="page">
        <div className="wrap">
          <h1>Inbox</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            The inbox is for the site owner. <Link to="/settings">Sign in</Link> or start demo mode to see it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1000 }}>
        <div className="eyebrow">Inbox{mode === 'demo' ? ' · demo' : ''}</div>
        <h1 style={{ marginTop: 4 }}>Things waiting on you</h1>
        <p className="lede" style={{ marginTop: 8 }}>
          Views to confirm or review, writing that still needs an English version, and unread research.
        </p>

        <Section title={`Views to confirm or review · ${due.length}`} sub="Price checks against your target, stop and horizon, and views past their review date.">
          {due.length ? (
            <div className="card" style={{ padding: '0 16px' }}>
              <div className="list">
                {due.map(({ t, perf }) => {
                  const d = display(t);
                  return (
                    <div key={t.id} className="list-item">
                      <div className="when">{perf.suggested ? STATUS_LABEL[perf.suggested] : 'Review'}</div>
                      <div className="min0">
                        <div className="title">
                          <Link to={`/thesis/${t.id}`}>{subjectLabel(d, site, nodeName)}</Link>
                        </div>
                        <p className="summary">{d.summary}</p>
                        <div className="meta">
                          {perf.suggested ? <span>Since {fmtDate(perf.suggestedOn)}</span> : null}
                          {t.reviewOn && t.reviewOn <= today ? <span className="down">Review was due {fmtDate(t.reviewOn)}</span> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty">Nothing to confirm.</div>
          )}
        </Section>

        <Section
          title={`English translations pending · ${toTranslate.length}`}
          sub="Written in Chinese and not yet translated, or changed since the last translation. Visitors see the Chinese text until then."
        >
          {toTranslate.length ? (
            <>
              <div className="card" style={{ padding: '0 16px' }}>
                <div className="list">
                  {toTranslate.map((r) => (
                    <div key={r.id} className="list-item">
                      <div className="when">{translationState(r) === 'stale' ? 'Changed' : 'New'}</div>
                      <div className="min0">
                        <div className="title">
                          <Link to={linkOf(r)}>{r.title || (r.type === 'thesis' ? r.summary : r.body?.slice(0, 80)) || r.id}</Link>
                        </div>
                        <div className="meta">
                          <span className="badge">{r.type}</span>
                          <span>{fmtDate(r.createdAt)}</span>
                          {r.visibility === 'public' ? <span>public</span> : <span>private</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="note-callout" style={{ marginTop: 12 }}>
                To translate, open a Claude Code session on this repository and say <b>“translate my pending notes”</b> (把待翻译的笔记翻译成英文). Claude reads these records from the
                private vault, writes the English next to the original and saves them; public copies update on the next build.
              </div>
            </>
          ) : (
            <div className="empty">Everything has an English version.</div>
          )}
        </Section>

        <Section title={`Unread private research · ${unread.length}`} sub="Sell-side notes and private reports in your vault that you have not marked as read.">
          {unread.length ? (
            <div className="card" style={{ padding: '0 14px' }}>
              {unread.map((r) => (
                <ReportRow key={r.id} r={r} site={site} />
              ))}
            </div>
          ) : (
            <div className="empty">{mode === 'owner' ? 'All caught up.' : 'Private research appears here once you sign in as the owner.'}</div>
          )}
        </Section>

        {loose.length ? (
          <Section title={`Notes without a subject · ${plural(loose.length, 'note')}`} sub="Tag them with a company or industry so they show up on the map.">
            <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
              {loose.map((n) => (
                <li key={n.id}>
                  <Link to={linkOf(n)}>{n.title || n.body?.slice(0, 80) || n.id}</Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function linkOf(r: AnyRecord): string {
  if (r.type === 'thesis') return `/thesis/${r.id}`;
  if (r.type === 'note') return `/notes#${r.id}`;
  if (r.type === 'outlook') return '/journal#outlook';
  return `/journal#${r.id}`;
}

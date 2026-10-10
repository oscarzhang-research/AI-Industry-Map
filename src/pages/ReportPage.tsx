import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store.tsx';
import { Change, CompanyChip, Crumbs, PrivateBadge, Segmented } from '../components/ui.tsx';
import { getRawFile } from '../lib/github.ts';
import { vaultFileUrl } from '../lib/vault.ts';
import { injectReaderShim, withReaderLang } from '../lib/reportShim.ts';
import { industryLink } from '../lib/nodes.ts';
import { isThesis } from '../lib/views.ts';
import { fmtDate, fmtPrice } from '../lib/format.ts';
import type { ReportMeta } from '../lib/types.ts';

type Lang = 'en' | 'zh';

export default function ReportPage() {
  const { id } = useParams();
  const { site, allReports, allRecords, prefs, setPrefs, mode, token, updateReport, toast } = useStore();
  const r = allReports.find((x) => x.id === id);
  const both = !!r?.languages?.includes('en') && !!r?.languages?.includes('zh');
  const [lang, setLang] = useState<Lang>(() => (prefs.reportLang === 'zh' ? 'zh' : 'en'));
  const effLang: Lang | undefined = r?.format === 'html' ? (both ? lang : r?.languages?.includes('zh') && !r.languages.includes('en') ? 'zh' : 'en') : undefined;
  const [html, setHtml] = useState<string>();
  const [pdf, setPdf] = useState<string>();
  const [error, setError] = useState<string>();
  const [details, setDetails] = useState(true);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setHtml(undefined);
    setPdf(undefined);
    setError(undefined);
    if (!r) return;
    (async () => {
      try {
        if (r.origin === 'vault') {
          const t = token();
          if (!t || !r.url) throw new Error('Sign in as the owner to open private files.');
          if (r.format === 'pdf') {
            objectUrl = await vaultFileUrl(t, site.config, r.url);
            if (alive) setPdf(objectUrl);
          } else {
            const buf = await getRawFile(t, site.config.repos.vault, r.url);
            if (alive) setHtml(injectReaderShim(new TextDecoder().decode(buf)));
          }
        } else if (r.url) {
          const res = await fetch(r.url);
          if (!res.ok) throw new Error(`Could not load the report (${res.status}).`);
          const text = await res.text();
          if (alive) setHtml(text);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [r, site.config, token]);

  const srcDoc = useMemo(() => (html ? withReaderLang(html, effLang) : undefined), [html, effLang]);
  const citing = useMemo(() => allRecords.filter(isThesis).filter((t) => t.reports?.includes(id ?? '')), [allRecords, id]);

  if (!r) {
    return (
      <div className="page">
        <div className="wrap">
          <Crumbs items={[{ label: 'Research', to: '/research' }, { label: 'Not found' }]} />
          <h1>Report not found</h1>
          <p className="lede" style={{ marginTop: 8 }}>
            It may be private.{' '}
            {mode === 'visitor' ? (
              <>
                If it is yours, <Link to="/settings">sign in</Link> to open it.
              </>
            ) : null}{' '}
            <Link to="/research">Back to the library</Link>.
          </p>
        </div>
      </div>
    );
  }

  const summary = (effLang === 'zh' ? r.summary?.zh : r.summary?.en) ?? r.summary?.en ?? r.summary?.zh;
  const title = effLang === 'zh' && r.titleZh ? r.titleZh : r.title;
  const kindLabel = r.kind === 'claude' ? 'Claude research' : r.kind === 'sell-side' ? `Sell-side · ${r.broker ?? 'broker'}` : 'Research';

  return (
    <div className="page" style={{ paddingBottom: 24 }}>
      <div className="wrap">
        <Crumbs items={[{ label: 'Research', to: '/research' }, { label: r.title }]} />
        <header className="page-head" style={{ alignItems: 'start', marginBottom: 16 }}>
          <div className="min0">
            <div className="row" style={{ gap: 6 }}>
              <span className="badge">{kindLabel}</span>
              {r.reportType ? <span className="badge">{r.reportType}</span> : null}
              {r.visibility === 'private' || r.origin === 'vault' ? <PrivateBadge /> : null}
              {r.interactive ? <span className="badge">Interactive</span> : null}
              <span className="muted" style={{ fontSize: 'var(--step--2)' }}>
                {fmtDate(r.date)}
                {r.asOf && r.asOf !== r.date ? ` · data as of ${fmtDate(r.asOf)}` : ''}
              </span>
            </div>
            <h1 style={{ marginTop: 10, fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)', maxWidth: '36ch' }}>{title}</h1>
            {r.subtitle && effLang !== 'zh' ? (
              <p className="lede" style={{ marginTop: 8, maxWidth: '75ch' }}>
                {r.subtitle}
              </p>
            ) : null}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {both ? (
              <Segmented
                label="Report language"
                value={lang}
                onChange={(v) => {
                  setLang(v);
                  setPrefs({ reportLang: v });
                }}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'zh', label: '中文' },
                ]}
              />
            ) : r.languages?.length === 1 && r.languages[0] === 'zh' ? (
              <span className="badge" title="This report exists in Chinese only">
                Chinese only
              </span>
            ) : null}
            <button type="button" className="btn sm" onClick={() => setDetails((v) => !v)} aria-expanded={details}>
              {details ? 'Hide key points' : 'Key points'}
            </button>
            {r.origin !== 'vault' && r.url ? (
              <a className="btn sm" href={`${r.url}${effLang ? `?lang=${effLang}` : ''}`} target="_blank" rel="noopener noreferrer">
                Open full page
              </a>
            ) : pdf ? (
              <a className="btn sm" href={pdf} download={`${r.id}.pdf`}>
                Download
              </a>
            ) : null}
            {r.origin === 'vault' && mode === 'owner' ? (
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  updateReport({ ...r, read: !r.read }).then(
                    () => toast(r.read ? 'Marked unread.' : 'Marked read.'),
                    (e: Error) => toast(e.message, 'error'),
                  )
                }
              >
                {r.read ? 'Mark unread' : 'Mark read'}
              </button>
            ) : null}
          </div>
        </header>

        {details ? <Details r={r} summary={summary} lang={effLang} citing={citing.map((t) => ({ id: t.id, label: t.title || t.summary }))} /> : null}

        <div className="reader" style={{ marginTop: 16 }}>
          {error ? (
            <div className="empty">{error}</div>
          ) : r.format === 'pdf' ? (
            pdf ? (
              <iframe className="reader-frame" title={r.title} src={pdf} />
            ) : (
              <div className="empty">
                <span className="spinner" /> Loading the PDF from your private vault…
              </div>
            )
          ) : srcDoc ? (
            <iframe
              key={effLang}
              className="reader-frame"
              title={r.title}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="empty">
              <span className="spinner" /> Loading…
            </div>
          )}
        </div>
        {r.kind === 'sell-side' ? (
          <p className="faint" style={{ marginTop: 8, fontSize: 'var(--step--2)' }}>
            Sell-side research is the broker’s copyrighted material. It is stored in the private vault and shown only to the owner.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Details({ r, summary, lang, citing }: { r: ReportMeta; summary?: string[]; lang?: Lang; citing: { id: string; label: string }[] }) {
  const { site, quotes, index } = useStore();
  const quote = r.priceRef?.symbol ? quotes.quotes[r.priceRef.symbol] : undefined;
  const mainCo = r.companies[0] ? site.companies[r.companies[0]] : undefined;
  const coQuote = mainCo?.symbol ? quotes.quotes[mainCo.symbol] : undefined;
  const tp = r.targetPrice;
  const pAt = r.priceAtReport;
  return (
    <div className="grid cols-2" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="card min0">
        {r.stance ? (
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-1)', lineHeight: 1.35 }}>{r.stance}</p>
        ) : null}
        {summary?.length ? (
          <ul className="prose" style={{ marginTop: r.stance ? 10 : 0, paddingLeft: '1.2em', fontSize: 'var(--step--1)' }}>
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No summary recorded.</p>
        )}
        {lang === 'zh' && !r.summary?.zh && r.summary?.en ? <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 6 }}>Summary in English only.</p> : null}
      </div>
      <div className="stack min0" style={{ '--gap': '12px' } as React.CSSProperties}>
        {r.kind === 'sell-side' ? (
          <div className="card">
            <dl className="kv">
              {r.broker ? (
                <>
                  <dt>Broker</dt>
                  <dd>{r.broker}</dd>
                </>
              ) : null}
              {r.analysts?.length ? (
                <>
                  <dt>Analysts</dt>
                  <dd>{r.analysts.join(', ')}</dd>
                </>
              ) : null}
              {r.rating ? (
                <>
                  <dt>Rating</dt>
                  <dd>{r.rating}</dd>
                </>
              ) : null}
              {tp ? (
                <>
                  <dt>Target price</dt>
                  <dd>
                    {fmtPrice(tp.value, tp.currency)}
                    {pAt ? (
                      <span className="muted">
                        {' '}
                        · <Change value={tp.value / pAt.value - 1} /> from {fmtPrice(pAt.value, pAt.currency)}
                        {pAt.date ? ` (${fmtDate(pAt.date, false)})` : ''}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              {tp && coQuote ? (
                <>
                  <dt>Now</dt>
                  <dd>
                    {fmtPrice(coQuote.c, coQuote.ccy)} · <Change value={tp.value / coQuote.c - 1} /> to target
                    {pAt ? (
                      <span className="muted">
                        {' '}
                        · <Change value={coQuote.c / pAt.value - 1} /> since the report
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : r.priceRef?.price && quote ? (
          <div className="card">
            <dl className="kv">
              <dt>Price in report</dt>
              <dd>
                {fmtPrice(r.priceRef.price, r.priceRef.currency)} {r.priceRef.date ? <span className="muted">({fmtDate(r.priceRef.date, false)})</span> : null}
              </dd>
              <dt>Since then</dt>
              <dd>
                {fmtPrice(quote.c, quote.ccy)} · <Change value={quote.c / r.priceRef.price - 1} />
              </dd>
            </dl>
          </div>
        ) : null}
        {r.companies.length ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Companies
            </div>
            <div className="chips">
              {r.companies.map((cid) => {
                const c = site.companies[cid];
                return c ? <CompanyChip key={cid} company={c} quote={c.symbol ? quotes.quotes[c.symbol] : undefined} show="d1" /> : null;
              })}
            </div>
          </div>
        ) : null}
        {r.nodes.length ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Filed under
            </div>
            <div className="chips">
              {r.nodes.map((n) => {
                const info = index.nodes.get(n);
                return info ? (
                  <Link key={n} className="chip" to={industryLink(n)}>
                    <span className="nm">
                      {info.kind === 'segment' ? `${info.industry?.name} · ${info.name}` : info.name}
                    </span>
                  </Link>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
        {citing.length ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Views citing this report
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.1em', fontSize: 'var(--step--1)' }}>
              {citing.map((c) => (
                <li key={c.id}>
                  <Link to={`/thesis/${c.id}`}>{c.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

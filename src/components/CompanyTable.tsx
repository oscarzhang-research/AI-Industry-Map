import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Company, Direction, Quote } from '../lib/types.ts';
import { Change } from './ui.tsx';
import { fmtCompact, fmtMultiple, fmtPrice, TIER_LABEL } from '../lib/format.ts';

type Key = 'name' | 'mcap' | 'd1' | 'm1' | 'ytd' | 'y1' | 'pe' | 'tgt';

/** Sortable table of companies with prices, returns, valuation and the owner's view. */
export function CompanyTable({ companies, quotes, views }: { companies: Company[]; quotes: Record<string, Quote>; views: Map<string, Direction> }) {
  const [key, setKey] = useState<Key>('mcap');
  const [asc, setAsc] = useState(false);
  const rows = useMemo(() => {
    const val = (c: Company): number | string | undefined => {
      const q = c.symbol ? quotes[c.symbol] : undefined;
      switch (key) {
        case 'name':
          return c.name.toLowerCase();
        case 'mcap':
          return q?.mcapUsd ?? (c.private?.valuation?.usd ?? -1);
        case 'd1':
          return q?.r.d1;
        case 'm1':
          return q?.r.m1;
        case 'ytd':
          return q?.r.ytd;
        case 'y1':
          return q?.r.y1;
        case 'pe':
          return q?.fpe ?? q?.pe;
        case 'tgt':
          return q?.tgt && q.c ? q.tgt / q.c - 1 : undefined;
      }
    };
    return [...companies].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return asc ? cmp : -cmp;
    });
  }, [companies, quotes, key, asc]);
  const th = (k: Key, label: string, num = true) => (
    <th
      className={`sortable${num ? ' n' : ''}`}
      onClick={() => {
        if (k === key) setAsc((v) => !v);
        else {
          setKey(k);
          setAsc(k === 'name');
        }
      }}
      aria-sort={k === key ? (asc ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      {k === key ? (asc ? ' ↑' : ' ↓') : ''}
    </th>
  );
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {th('name', 'Company', false)}
            <th>Ticker</th>
            <th>Tier</th>
            <th>View</th>
            <th className="n">Price</th>
            {th('d1', '1D')}
            {th('m1', '1M')}
            {th('ytd', 'YTD')}
            {th('y1', '1Y')}
            {th('mcap', 'Mkt cap')}
            {th('pe', 'P/E (fwd)')}
            {th('tgt', 'To consensus')}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const q = c.symbol ? quotes[c.symbol] : undefined;
            const v = views.get(c.id);
            return (
              <tr key={c.id}>
                <td style={{ minWidth: 170 }}>
                  <Link to={`/company/${c.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {c.name}
                  </Link>
                  {c.nameZh && c.nameZh !== c.name ? <span className="faint"> · {c.nameZh}</span> : null}
                </td>
                <td className="tk">{c.listing === 'listed' ? c.symbol ?? 'pending' : c.listing === 'private' ? 'Private' : 'Acquired'}</td>
                <td className="muted">{TIER_LABEL[c.tier]}</td>
                <td>{v === 'long' ? <span className="up">▲ Long</span> : v === 'short' ? <span className="down">▼ Short</span> : v ? <span className="muted">{v}</span> : ''}</td>
                <td className="n">{q ? fmtPrice(q.c, q.ccy) : '—'}</td>
                <td className="n">
                  <Change value={q?.r.d1} />
                </td>
                <td className="n">
                  <Change value={q?.r.m1} />
                </td>
                <td className="n">
                  <Change value={q?.r.ytd} />
                </td>
                <td className="n">
                  <Change value={q?.r.y1} />
                </td>
                <td className="n">
                  {q?.mcapUsd ? fmtCompact(q.mcapUsd) : c.private?.valuation?.usd ? <span className="muted">{fmtCompact(c.private.valuation.usd)}*</span> : '—'}
                </td>
                <td className="n">{fmtMultiple(q?.fpe ?? q?.pe)}</td>
                <td className="n">{q?.tgt ? <Change value={q.tgt / q.c - 1} /> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

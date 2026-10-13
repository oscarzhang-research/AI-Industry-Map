// Weekly fact pack: a private journal draft with the week's numbers, for the owner to complete.
// Run after `npm run build-data`:
//   node scripts/fact-pack.ts [--vault <dir>] [--week-ending YYYY-MM-DD] [--write] [--force]
// Without --write it prints the draft. With --write it saves vault/journal/<id>.md (private, tagged
// fact-pack and draft) unless that file exists (--force replaces a draft, never an entry the owner edited).
// Facts only: prices, the owner's views against them, earnings, indicators, news and the week ahead.
// The "My read" section is left empty for the owner; nothing here states a view.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { daysBetween, indexOnOrBefore, thesisPerformance } from '../src/lib/finance.ts';
import { fmtEps, recentReports, upcomingReports } from '../src/lib/earnings.ts';
import { thesisSeriesFrom } from '../src/lib/thesisSeries.ts';
import { display, subjectLabel } from '../src/lib/views.ts';
import { fmtCompact, fmtDate, fmtPct, todayISO } from '../src/lib/format.ts';
import { parseRecordFile, serializeRecord } from '../src/lib/records.ts';
import type { IndexSeries, JournalRecord, ThesisRecord } from '../src/lib/types.ts';
import { loadGenerated, type Generated } from './lib/generated.ts';
import { arg, flag, readRecords, siteConfig, vaultDir, writeFile } from './lib/vaultfs.ts';

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shift = (d: string, n: number) => iso(Date.parse(d) + n * DAY);

/** Monday and Friday of the week a date falls in; on weekends and Monday mornings, the week just ended. */
export function weekOf(day: string): { start: string; end: string } {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday .. 6 Saturday
  const friday = wd === 6 ? shift(day, -1) : wd === 0 ? shift(day, -2) : shift(day, 5 - wd);
  return { start: shift(friday, -4), end: friday };
}

function change(d: string[], v: number[], from: string, to: string): number | undefined {
  const i0 = indexOnOrBefore(d, from);
  const i1 = indexOnOrBefore(d, to);
  return i0 >= 0 && i1 > i0 ? v[i1] / v[i0] - 1 : undefined;
}

export function buildFactPack(g: Generated, theses: ThesisRecord[], week: { start: string; end: string }, made: string): string {
  const prevClose = shift(week.start, -1); // last close before Monday
  const out: string[] = [];
  out.push(
    `> Draft prepared automatically on ${fmtDate(made)} from the site's market data, news and your views. Facts only: write your read at the end, then delete this note and the "draft" tag.`,
    '',
  );

  // ---- Markets ----------------------------------------------------------------------------------
  out.push('## Markets this week', '', '| Layer | Market-cap weighted | Equal weight | Best | Worst |', '| --- | ---: | ---: | --- | --- |');
  const layers = g.site.layers.slice().sort((a, b) => a.order - b.order);
  for (const l of layers) {
    const cap = g.indices.series.find((s: IndexSeries) => s.kind === 'layer' && s.id === l.id);
    const eq = g.indices.series.find((s: IndexSeries) => s.kind === 'layer-equal' && s.id === l.id);
    const moves = Object.values(g.site.companies)
      .filter((c) => c.primaryLayer === l.id && c.listing === 'listed' && c.symbol && c.tier !== 'watch')
      .map((c) => {
        const s = g.series(c.symbol!);
        return { c, r: s ? change(s.d, s.c, prevClose, week.end) : undefined };
      })
      .filter((x): x is { c: (typeof x)['c']; r: number } => x.r !== undefined)
      .sort((a, b) => b.r - a.r);
    const best = moves.slice(0, 2).map((x) => `${x.c.name} ${fmtPct(x.r)}`).join(', ');
    const worst = moves.slice(-2).reverse().map((x) => `${x.c.name} ${fmtPct(x.r)}`).join(', ');
    out.push(`| L${l.order} ${l.name} | ${fmtPct(cap ? change(cap.d, cap.v, prevClose, week.end) : undefined)} | ${fmtPct(eq ? change(eq.d, eq.v, prevClose, week.end) : undefined)} | ${best || '—'} | ${worst || '—'} |`);
  }
  out.push('', 'Weekly change from the close before Monday to the latest close in the week. Best and worst among core and focus companies in each layer.', '');

  // ---- Views --------------------------------------------------------------------------------------
  const nodeName = (p: string) => {
    const [l, i] = p.split('/');
    const layer = g.site.layers.find((x) => x.id === l);
    return (i ? layer?.industries.find((x) => x.id === i)?.name : layer?.name) ?? p;
  };
  const active = theses.filter((t) => t.status === 'active' && !t.example);
  out.push('## My views against the market', '');
  if (!active.length) out.push('No active views.', '');
  else {
    out.push('| View | Direction | This week | Since open | vs benchmark | Flags |', '| --- | --- | ---: | ---: | ---: | --- |');
    for (const raw of active) {
      const t = display(raw);
      const { series, bench } = thesisSeriesFrom(t, g.site, g.indices, g.series);
      const perf = thesisPerformance(t, series, bench, week.end);
      const sign = t.direction === 'short' ? -1 : 1;
      const wk = series ? change(series.d, series.c, prevClose, week.end) : undefined;
      const flags = [
        perf.suggested === 'target-hit' ? `target reached ${fmtDate(perf.suggestedOn, false)}` : '',
        perf.suggested === 'stopped' ? `stop crossed ${fmtDate(perf.suggestedOn, false)}` : '',
        perf.suggested === 'expired' ? `horizon ended ${fmtDate(perf.suggestedOn, false)}` : '',
        t.reviewOn && t.reviewOn <= shift(week.end, 7) ? `review ${t.reviewOn <= week.end ? 'was due' : 'due'} ${fmtDate(t.reviewOn, false)}` : '',
        perf.target && perf.upside !== undefined ? `${fmtPct(perf.upside)} to target` : '',
      ].filter(Boolean);
      out.push(`| [${subjectLabel(t, g.site, nodeName)}](#/thesis/${t.id}) | ${t.direction} | ${fmtPct(wk === undefined ? undefined : sign * wk)} | ${fmtPct(perf.ret)} | ${fmtPct(perf.excess)} | ${flags.join('; ') || '—'} |`);
    }
    out.push('', 'Returns are in the direction of each view.', '');
  }

  // ---- Earnings ---------------------------------------------------------------------------------
  const reported = recentReports(g.site, g.quotes.quotes, g.earnings, week.start, shift(week.end, 2)).filter((r) => r.company.tier !== 'watch');
  const ahead = upcomingReports(g.site, g.quotes.quotes, g.earnings, shift(week.end, 1), shift(week.end, 9)).filter((r) => r.company.tier !== 'watch');
  out.push('## Earnings', '');
  if (reported.length) {
    out.push('Reported this week (core and focus companies):', '', '| Company | Date | EPS vs consensus | Revenue vs consensus | Shares, two sessions |', '| --- | --- | --- | --- | ---: |');
    for (const { company, report: r, ccy } of reported) {
      const eps = r.epsActual !== undefined ? `${fmtEps(r.epsActual)} vs ${fmtEps(r.epsEst)}${r.surprise !== undefined ? ` (${fmtPct(r.surprise / 100)})` : ''}` : '—';
      const rev = r.revActual ? `${fmtCompact(r.revActual, ccy ?? 'USD')}${r.revSurprise !== undefined ? ` (${fmtPct(r.revSurprise)})` : ''}` : '—';
      out.push(`| ${company.name} | ${fmtDate(r.date, false)} | ${eps} | ${rev} | ${fmtPct(r.move)} |`);
    }
    out.push('');
  } else out.push('No core or focus company reported this week.', '');
  if (ahead.length) {
    const shown = ahead.slice(0, 15).map((u) => `${u.company.name} (${fmtDate(u.date, false)})`);
    out.push(`Next week: ${shown.join(', ')}${ahead.length > 15 ? ` and ${ahead.length - 15} more` : ''}.`, '');
  }

  // ---- Indicators -----------------------------------------------------------------------------------
  const kpiLines: string[] = [];
  for (const k of g.kpis.indicators) {
    if (k.kind === 'monthly') {
      const i = k.values.length - 1;
      kpiLines.push(`- ${k.name}: ${fmtCompact(k.values[i], k.unit ?? 'TWD')} in ${k.months[i]}${k.yoy[i] !== null ? `, ${fmtPct(k.yoy[i])} year on year` : ''}.`);
    } else if (k.kind === 'stack') {
      const i = k.complete.lastIndexOf(true);
      if (i >= 0) {
        const prev = i >= 4 && k.complete[i - 4] ? k.total[i - 4] : null;
        kpiLines.push(`- ${k.name}: ${fmtCompact(k.total[i]!, k.unit ?? 'USD')} in ${k.periods[i]}${prev ? `, ${fmtPct(k.total[i]! / prev - 1)} year on year` : ''}.`);
      }
    } else if (k.kind === 'growth-table') {
      const last = k.periods.length - 1;
      const vals = k.rows.map((r) => ({ r, v: r.values[last] })).filter((x): x is { r: (typeof x)['r']; v: number } => x.v !== null);
      if (vals.length) kpiLines.push(`- ${k.name}, ${k.periods[last]}: ${vals.map((x) => `${x.r.label} ${fmtPct(x.v, 0)}`).join(', ')}.`);
    }
  }
  if (kpiLines.length) out.push('## Indicators', '', ...kpiLines, '');

  // ---- News -----------------------------------------------------------------------------------------
  const news = g.news.filter((n) => n.date >= week.start && n.date <= shift(week.end, 2) && (n.importance ?? 1) >= 2);
  out.push('## News that mattered', '');
  if (news.length) for (const n of news.slice(0, 15)) out.push(`- ${fmtDate(n.date, false)} · ${n.source?.url ? `[${n.title}](${n.source.url})` : n.title}${n.source?.name ? ` (${n.source.name})` : ''}`);
  else out.push('No notable items this week.');
  out.push('');

  // ---- Week ahead -----------------------------------------------------------------------------------
  const events = g.site.events.filter((e) => e.start > week.end && daysBetween(week.end, e.start) <= 9);
  const catalysts = active.flatMap((t) => (t.catalysts ?? []).filter((c) => c.date && c.date > week.end && daysBetween(week.end, c.date) <= 9 && c.status !== 'happened').map((c) => ({ t, c })));
  out.push('## Next week', '');
  if (!events.length && !catalysts.length) out.push('Nothing scheduled beyond the earnings above.');
  for (const e of events) out.push(`- ${fmtDate(e.start, false)} · ${e.name}${e.tentative ? ' (date tentative)' : ''}`);
  for (const { t, c } of catalysts) out.push(`- ${fmtDate(c.date, false)} · ${c.label} (catalyst in [${display(t).title || display(t).summary}](#/thesis/${t.id}))`);
  out.push('');

  // ---- For the owner ----------------------------------------------------------------------------------
  out.push('## My read', '', '- What changed this week:', '- Where the bottleneck is now:', '- Views confirmed or challenged:', '- What I will watch next week:', '');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = siteConfig();
  const today = todayISO(config.site.timezone);
  const week = weekOf(arg('week-ending') ?? today);
  const vault = vaultDir()!;
  const g = loadGenerated();
  const records = readRecords(join(vault, 'vault')).map((x) => x.rec);
  const theses = records.filter((r): r is ThesisRecord => r.type === 'thesis');
  const body = buildFactPack(g, theses, week, today);
  const id = `jr-${week.end}-week-facts`;
  const file = join(vault, 'vault', 'journal', `${id}.md`);
  const rec: JournalRecord = {
    id,
    type: 'journal',
    title: `Week of ${fmtDate(week.start, false)} – ${fmtDate(week.end)}: the numbers`,
    visibility: 'private',
    lang: 'en',
    createdAt: new Date().toISOString(),
    tags: ['fact-pack', 'draft'],
    period: { kind: 'week', start: week.start, end: week.end },
    links: theses.filter((t) => t.status === 'active' && !t.example).map((t) => t.id),
    body,
  };
  if (!flag('write')) {
    console.log(serializeRecord(rec));
  } else {
    if (existsSync(file)) {
      const prev = parseRecordFile(readFileSync(file, 'utf8'));
      if (!flag('force') || !(prev.tags ?? []).includes('draft')) {
        console.error(`${file} exists${(prev.tags ?? []).includes('draft') ? ' (pass --force to replace the draft)' : ' and has been edited; left alone'}.`);
        process.exit(1);
      }
    }
    writeFile(file, serializeRecord(rec));
    console.log(`Wrote ${file}`);
  }
}
